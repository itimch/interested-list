const { findLeadByEmail, createTask } = require('./notion');
const { Client } = require('@notionhq/client');

// Gmail polling via the Gmail MCP is not available at runtime in the Node process.
// Instead this module exports a handler that can be called from Claude/MCP context,
// and a lightweight REST endpoint that accepts Gmail data pushed from an external poller.

/**
 * Process a single inbound email and update the matching lead in Notion.
 * Call this from the POST /webhooks/gmail endpoint.
 */
async function handleInboundEmail({ fromEmail, fromName, subject, snippet, date }) {
  if (!fromEmail) return { handled: false, reason: 'no_email' };

  const existing = await findLeadByEmail(fromEmail);
  if (!existing) return { handled: false, reason: 'lead_not_found', email: fromEmail };

  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  await notion.pages.update({
    page_id: existing.id,
    properties: {
      Status: { select: { name: 'Replied' } },
      'Last Contacted': { date: { start: (date || new Date().toISOString()).slice(0, 10) } },
    },
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  await createTask({
    task: `Reply to ${fromName || fromEmail}${subject ? ` — ${subject}` : ''}`,
    dueDate: tomorrow.toISOString().slice(0, 10),
    priority: 'Urgent',
    type: 'Follow-Up Email',
    notes: snippet ? `They said: "${snippet.slice(0, 300)}"` : '',
    leadPageId: existing.id,
  });

  return { handled: true, action: 'reply_logged', leadId: existing.id };
}

/**
 * Scan a list of Gmail threads (from MCP or API) and process any lead replies.
 * threads: array of { sender, subject, snippet, date }
 */
async function processGmailThreads(threads) {
  const results = [];
  for (const thread of threads) {
    const result = await handleInboundEmail({
      fromEmail: thread.sender,
      fromName: thread.senderName,
      subject: thread.subject,
      snippet: thread.snippet,
      date: thread.date,
    });
    if (result.handled) results.push(result);
  }
  return results;
}

module.exports = { handleInboundEmail, processGmailThreads };
