const { google } = require('googleapis');
const axios = require('axios');
const { upsertLead, createTask, findLeadByEmail } = require('./notion');
const { Client } = require('@notionhq/client');

const INTERNAL_DOMAINS = ['sequenceminds.com', 'gmail.com', 'hotmail.com', 'outlook.com'];
const MEETING_KEYWORDS = ['discovery', 'intro', 'lead gen', 'sync', 'catch up', 'meeting', 'call'];

function isExternalLead(email, summary) {
  if (!email) return false;
  const domain = email.split('@')[1] || '';
  if (INTERNAL_DOMAINS.includes(domain)) return false;
  const title = (summary || '').toLowerCase();
  return MEETING_KEYWORDS.some(k => title.includes(k));
}

function buildGoogleAuth() {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: process.env.GOOGLE_ACCESS_TOKEN });
  return auth;
}

function extractCompanyFromEmail(email) {
  const domain = email.split('@')[1] || '';
  return domain.replace(/\.(com|org|net|io|ai|co)$/, '').replace(/\./g, ' ');
}

/**
 * Call Clay API to enrich a person + company by email domain.
 * Returns { title, companyName, companySize, linkedinUrl, summary } or null.
 */
async function enrichWithClay(email, name) {
  const CLAY_API_KEY = process.env.CLAY_API_KEY;
  if (!CLAY_API_KEY) return null;

  const domain = email.split('@')[1];
  try {
    // Clay enrichment endpoint — enrich person by email
    const resp = await axios.post(
      'https://api.clay.com/v1/sources/person-search/run',
      { email, domain },
      {
        headers: {
          Authorization: `Bearer ${CLAY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 8000,
      }
    );

    const person = resp.data?.data?.[0];
    if (!person) return null;

    return {
      title: person.title || person.job_title || '',
      companyName: person.company_name || extractCompanyFromEmail(email),
      companySize: person.company_size || '',
      linkedinUrl: person.linkedin_url || '',
      summary: [
        person.title && `${person.title} at ${person.company_name}`,
        person.company_size && `Company size: ${person.company_size}`,
        person.company_description,
      ]
        .filter(Boolean)
        .join(' | '),
    };
  } catch (err) {
    console.warn(`[gcal] Clay enrichment failed for ${email}:`, err.message);
    return null;
  }
}

/**
 * Sync recent Google Calendar events → Notion leads.
 * Looks back `lookbackDays` and forward `forwardDays`.
 */
async function syncGoogleCalendarToNotion(lookbackDays = 7, forwardDays = 30) {
  const auth = buildGoogleAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - lookbackDays);
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + forwardDays);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });

  const events = res.data.items || [];
  let created = 0;
  let updated = 0;

  for (const event of events) {
    const summary = event.summary || '';
    const attendees = event.attendees || [];
    const startTime = event.start?.dateTime || event.start?.date;

    const externalAttendees = attendees.filter(a =>
      !a.organizer && !a.self && isExternalLead(a.email, summary)
    );

    for (const attendee of externalAttendees) {
      const email = attendee.email;
      const name = attendee.displayName || email.split('@')[0];

      try {
        const existing = await findLeadByEmail(email);

        if (existing) {
          const notion = new Client({ auth: process.env.NOTION_TOKEN });
          await notion.pages.update({
            page_id: existing.id,
            properties: {
              Status: { select: { name: 'Meeting Booked' } },
              'Last Contacted': { date: { start: startTime.slice(0, 10) } },
              'AI Summary': {
                rich_text: [{ text: { content: `Meeting: "${summary}" on ${startTime.slice(0, 10)}` } }],
              },
            },
          });
          updated++;
        } else {
          // Enrich person/company via Clay before creating the Notion record
          const enriched = await enrichWithClay(email, name);
          const company = enriched?.companyName || extractCompanyFromEmail(email);

          await upsertLead({
            hubspotId: '',
            name,
            company,
            email,
            status: 'Meeting Booked',
            source: 'Gmail',
            lastContacted: startTime,
            aiSummary: enriched?.summary
              ? `${enriched.summary} | Meeting: "${summary}" on ${startTime.slice(0, 10)}`
              : `Meeting: "${summary}" on ${startTime.slice(0, 10)}`,
          });
          created++;

          // Create post-meeting follow-up task
          const followUpDate = new Date(startTime);
          followUpDate.setDate(followUpDate.getDate() + 1);
          const lead = await findLeadByEmail(email);
          if (lead) {
            await createTask({
              task: `Follow up with ${name} after "${summary}"`,
              dueDate: followUpDate.toISOString().slice(0, 10),
              priority: 'Today',
              type: 'Follow-Up Email',
              notes: enriched?.summary
                ? `Meeting on ${startTime.slice(0, 10)} | ${enriched.summary}`
                : `Meeting on ${startTime.slice(0, 10)}`,
              leadPageId: lead.id,
            });
          }
        }
      } catch (err) {
        console.error(`[gcal] Error processing ${email}:`, err.message);
      }
    }
  }

  const result = { events: events.length, created, updated };
  console.log('[gcal] Sync done:', result);
  return result;
}

module.exports = { syncGoogleCalendarToNotion };
