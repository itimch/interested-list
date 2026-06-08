const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const LEADS_DB = process.env.NOTION_LEADS_DB;
const TASKS_DB = process.env.NOTION_TASKS_DB;

// v5 of @notionhq/client moved database querying to dataSources.query
async function queryDatabase(database_id, filter, sorts) {
  const res = await notion.dataSources.query({
    data_source_id: database_id,
    ...(filter && { filter }),
    ...(sorts && { sorts }),
  });
  return res.results || [];
}

async function findLeadByHubSpotId(hubspotId) {
  const results = await queryDatabase(LEADS_DB, {
    property: 'HubSpot ID',
    rich_text: { equals: String(hubspotId) },
  });
  return results[0] || null;
}

async function findLeadByEmail(email) {
  const results = await queryDatabase(LEADS_DB, {
    property: 'Email',
    email: { equals: email },
  });
  return results[0] || null;
}

async function upsertLead(data) {
  const {
    hubspotId, name, company, email,
    status, source, lastContacted, nextFollowUp, aiSummary,
  } = data;

  const properties = {
    Name: { title: [{ text: { content: name || email } }] },
    Email: { email },
    'HubSpot ID': { rich_text: [{ text: { content: String(hubspotId || '') } }] },
    Status: { select: { name: status } },
    Source: { select: { name: source || 'HubSpot' } },
  };

  if (company) properties.Company = { rich_text: [{ text: { content: company } }] };
  if (lastContacted) properties['Last Contacted'] = { date: { start: lastContacted.slice(0, 10) } };
  if (nextFollowUp) properties['Next Follow-Up'] = { date: { start: nextFollowUp.slice(0, 10) } };
  if (aiSummary) properties['AI Summary'] = { rich_text: [{ text: { content: aiSummary.slice(0, 2000) } }] };

  const existing = hubspotId ? await findLeadByHubSpotId(hubspotId) : await findLeadByEmail(email);

  if (existing) {
    await notion.pages.update({ page_id: existing.id, properties });
    return { action: 'updated', id: existing.id };
  } else {
    const page = await notion.pages.create({
      parent: { database_id: LEADS_DB },
      properties,
    });
    return { action: 'created', id: page.id };
  }
}

async function createTask(data) {
  const { task, dueDate, priority, type, notes, leadPageId } = data;

  const properties = {
    Task: { title: [{ text: { content: task } }] },
    Priority: { select: { name: priority || 'This Week' } },
    Done: { checkbox: false },
  };

  if (type) properties.Type = { select: { name: type } };
  if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };
  if (dueDate) properties['Due Date'] = { date: { start: dueDate } };
  if (leadPageId) properties.Lead = { relation: [{ id: leadPageId }] };

  return notion.pages.create({ parent: { database_id: TASKS_DB }, properties });
}

async function getOverdueTasks() {
  const today = new Date().toISOString().slice(0, 10);
  return queryDatabase(
    TASKS_DB,
    {
      and: [
        { property: 'Done', checkbox: { equals: false } },
        { property: 'Due Date', date: { on_or_before: today } },
      ],
    },
    [{ property: 'Due Date', direction: 'ascending' }]
  );
}

async function getLeadsDueForFollowUp() {
  const today = new Date().toISOString().slice(0, 10);
  return queryDatabase(
    LEADS_DB,
    {
      and: [
        { property: 'Next Follow-Up', date: { on_or_before: today } },
        {
          or: [
            { property: 'Status', select: { equals: 'Replied' } },
            { property: 'Status', select: { equals: 'Interested' } },
            { property: 'Status', select: { equals: 'Meeting Booked' } },
          ],
        },
      ],
    },
    [{ property: 'Next Follow-Up', direction: 'ascending' }]
  );
}

module.exports = { upsertLead, createTask, findLeadByEmail, findLeadByHubSpotId, getOverdueTasks, getLeadsDueForFollowUp };
