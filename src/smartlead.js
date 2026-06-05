const crypto = require('crypto');
const { upsertLead, createTask, findLeadByEmail } = require('./notion');

function verifySmartleadSignature(req, secret) {
  const signature = req.headers['x-smartlead-signature'];
  if (!signature || !secret) return true; // skip if not configured
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(req.body));
  return signature === hmac.digest('hex');
}

async function handleSmartleadWebhook(event) {
  const { event_type, lead_email, lead_name, campaign_name, reply_text } = event;

  console.log(`[smartlead] Event: ${event_type} from ${lead_email}`);

  if (event_type === 'EMAIL_REPLY') {
    const existing = await findLeadByEmail(lead_email);
    let leadPageId;

    if (existing) {
      // Update status to Replied
      const { Client } = require('@notionhq/client');
      const notion = new Client({ auth: process.env.NOTION_TOKEN });
      await notion.pages.update({
        page_id: existing.id,
        properties: {
          Status: { select: { name: 'Replied' } },
          'Last Contacted': { date: { start: new Date().toISOString().slice(0, 10) } },
        },
      });
      leadPageId = existing.id;
    } else {
      const result = await upsertLead({
        hubspotId: '',
        name: lead_name || lead_email,
        email: lead_email,
        status: 'Replied',
        source: 'Smartlead',
        lastContacted: new Date().toISOString(),
      });
      leadPageId = result.id;
    }

    // Create a follow-up task
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    await createTask({
      task: `Reply to ${lead_name || lead_email}${campaign_name ? ` — ${campaign_name}` : ''}`,
      dueDate: tomorrow.toISOString().slice(0, 10),
      priority: 'Urgent',
      type: 'Follow-Up Email',
      notes: reply_text ? `They said: "${reply_text.slice(0, 300)}"` : '',
      leadPageId,
    });

    return { handled: true, action: 'reply_logged' };
  }

  if (event_type === 'EMAIL_OPENED') {
    // Just update last contacted, don't create task for opens
    const existing = await findLeadByEmail(lead_email);
    if (existing) {
      const { Client } = require('@notionhq/client');
      const notion = new Client({ auth: process.env.NOTION_TOKEN });
      await notion.pages.update({
        page_id: existing.id,
        properties: {
          'Last Contacted': { date: { start: new Date().toISOString().slice(0, 10) } },
        },
      });
    }
    return { handled: true, action: 'open_logged' };
  }

  return { handled: false, event_type };
}

module.exports = { handleSmartleadWebhook, verifySmartleadSignature };
