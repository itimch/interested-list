const axios = require('axios');
const { upsertLead, createTask, findLeadByEmail } = require('./notion');
const { Client } = require('@notionhq/client');

const calendly = axios.create({
  baseURL: 'https://api.calendly.com',
  headers: { Authorization: `Bearer ${process.env.CALENDLY_TOKEN}` },
});

/**
 * Handle a Calendly webhook event (invitee.created or invitee.canceled).
 */
async function handleCalendlyWebhook(payload) {
  const event = payload.event;
  const invitee = payload.payload;

  if (event === 'invitee.created') {
    const email = invitee.email;
    const name = invitee.name;
    const eventName = invitee.event_type_name || '30 Minute Meeting';
    const startTime = invitee.scheduled_event?.start_time;

    const existing = await findLeadByEmail(email);
    let leadPageId;

    if (existing) {
      const notion = new Client({ auth: process.env.NOTION_TOKEN });
      await notion.pages.update({
        page_id: existing.id,
        properties: {
          Status: { select: { name: 'Meeting Booked' } },
          'Last Contacted': { date: { start: new Date().toISOString().slice(0, 10) } },
          ...(startTime && {
            'Next Follow-Up': { date: { start: startTime.slice(0, 10) } },
          }),
        },
      });
      leadPageId = existing.id;
      console.log(`[calendly] Updated existing lead: ${email}`);
    } else {
      const result = await upsertLead({
        hubspotId: '',
        name,
        email,
        status: 'Meeting Booked',
        source: 'Smartlead',
        lastContacted: new Date().toISOString(),
        nextFollowUp: startTime,
      });
      leadPageId = result.id;
      console.log(`[calendly] Created new lead: ${email}`);
    }

    // Create a follow-up task for after the meeting
    if (startTime) {
      const followUpDate = new Date(startTime);
      followUpDate.setDate(followUpDate.getDate() + 1);
      await createTask({
        task: `Follow up after meeting with ${name} — ${eventName}`,
        dueDate: followUpDate.toISOString().slice(0, 10),
        priority: 'Today',
        type: 'Follow-Up Email',
        notes: `Meeting scheduled for ${new Date(startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
        leadPageId,
      });
    }

    return { handled: true, action: 'meeting_booked', email };
  }

  if (event === 'invitee.canceled') {
    const email = invitee.email;
    const existing = await findLeadByEmail(email);
    if (existing) {
      const notion = new Client({ auth: process.env.NOTION_TOKEN });
      await notion.pages.update({
        page_id: existing.id,
        properties: {
          Status: { select: { name: 'Replied' } },
        },
      });
    }
    return { handled: true, action: 'meeting_canceled', email };
  }

  return { handled: false, event };
}

module.exports = { handleCalendlyWebhook };
