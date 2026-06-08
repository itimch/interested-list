const axios = require('axios');
const { findLeadByEmail } = require('./notion');
const { Client } = require('@notionhq/client');

const FATHOM_API_KEY = process.env.FATHOM_API_KEY;

const SKIP_TITLE_KEYWORDS = ['interview', '15 min with sequence minds', 'screening', 'sdr interview'];
const SKIP_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
const INTERNAL_DOMAINS = ['sequenceminds.com'];

function shouldSkipMeeting(title) {
  const t = (title || '').toLowerCase();
  return SKIP_TITLE_KEYWORDS.some(k => t.includes(k));
}

function isExternalProspect(email) {
  if (!email) return false;
  const domain = email.split('@')[1] || '';
  return !SKIP_DOMAINS.includes(domain) && !INTERNAL_DOMAINS.includes(domain);
}

async function getFathomMeetings(createdAfter) {
  const resp = await axios.get('https://api.fathom.video/v2/calls', {
    headers: { Authorization: `Bearer ${FATHOM_API_KEY}` },
    params: {
      created_after: createdAfter,
      page_size: 50,
    },
  });
  return resp.data.data || [];
}

async function getFathomSummary(callId) {
  const resp = await axios.get(`https://api.fathom.video/v2/calls/${callId}/summary`, {
    headers: { Authorization: `Bearer ${FATHOM_API_KEY}` },
  });
  return resp.data?.summary || '';
}

/**
 * Sync recent Fathom meetings → update matching Notion leads with AI summary.
 */
async function syncFathomToNotion(lookbackDays = 7) {
  if (!FATHOM_API_KEY) {
    console.log('[fathom] FATHOM_API_KEY not set, skipping');
    return { skipped: true };
  }

  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const meetings = await getFathomMeetings(since.toISOString());
  console.log(`[fathom] Found ${meetings.length} meetings in last ${lookbackDays} days`);

  let updated = 0;
  let skipped = 0;

  for (const meeting of meetings) {
    const title = meeting.title || meeting.name || '';

    if (shouldSkipMeeting(title)) {
      skipped++;
      continue;
    }

    const attendees = (meeting.calendar_invitees || []).map(a => a.email).filter(Boolean);
    const prospects = attendees.filter(isExternalProspect);

    if (prospects.length === 0) {
      skipped++;
      continue;
    }

    // Get AI summary for this meeting
    let summary = '';
    try {
      summary = await getFathomSummary(meeting.id);
    } catch (err) {
      console.warn(`[fathom] Could not fetch summary for ${meeting.id}:`, err.message);
      continue;
    }

    if (!summary) {
      skipped++;
      continue;
    }

    const meetingDate = (meeting.started_at || meeting.created_at || '').slice(0, 10);
    const notionSummary = `Meeting: "${title}" on ${meetingDate}\n\n${summary}`.slice(0, 2000);

    // Update each matching lead in Notion
    for (const email of prospects) {
      try {
        const lead = await findLeadByEmail(email);
        if (!lead) continue;

        const notion = new Client({ auth: process.env.NOTION_TOKEN });
        await notion.pages.update({
          page_id: lead.id,
          properties: {
            'AI Summary': { rich_text: [{ text: { content: notionSummary } }] },
            'Last Contacted': { date: { start: meetingDate } },
            Status: { select: { name: 'Meeting Booked' } },
          },
        });
        console.log(`[fathom] Updated lead ${email} with summary from "${title}"`);
        updated++;
      } catch (err) {
        console.error(`[fathom] Error updating ${email}:`, err.message);
      }
    }
  }

  const result = { meetings: meetings.length, updated, skipped };
  console.log('[fathom] Sync done:', result);
  return result;
}

module.exports = { syncFathomToNotion };
