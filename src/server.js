require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { syncHubSpotToNotion } = require('./sync');
const { handleSmartleadWebhook, verifySmartleadSignature } = require('./smartlead');
const { getOverdueTasks, getLeadsDueForFollowUp } = require('./notion');

const app = express();
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Sequence Minds CRM Sync', time: new Date().toISOString() });
});

// ── Manual sync trigger ───────────────────────────────────────────────────────
app.post('/sync/hubspot', async (req, res) => {
  try {
    const summary = await syncHubSpotToNotion(req.body.limit || 100);
    res.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[/sync/hubspot]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Smartlead webhook ─────────────────────────────────────────────────────────
app.post('/webhooks/smartlead', async (req, res) => {
  if (!verifySmartleadSignature(req, process.env.SMARTLEAD_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  try {
    const result = await handleSmartleadWebhook(req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[/webhooks/smartlead]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Daily follow-up digest ────────────────────────────────────────────────────
app.get('/digest', async (req, res) => {
  try {
    const [overdueTasks, dueLeads] = await Promise.all([
      getOverdueTasks(),
      getLeadsDueForFollowUp(),
    ]);

    const digest = {
      date: new Date().toISOString().slice(0, 10),
      urgent: overdueTasks.map(t => ({
        task: t.properties.Task?.title?.[0]?.plain_text,
        dueDate: t.properties['Due Date']?.date?.start,
        priority: t.properties.Priority?.select?.name,
        url: t.url,
      })),
      followUps: dueLeads.map(l => ({
        name: l.properties.Name?.title?.[0]?.plain_text,
        company: l.properties.Company?.rich_text?.[0]?.plain_text,
        status: l.properties.Status?.select?.name,
        nextFollowUp: l.properties['Next Follow-Up']?.date?.start,
        url: l.url,
      })),
    };

    res.json(digest);
  } catch (err) {
    console.error('[/digest]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Scheduled sync ────────────────────────────────────────────────────────────
const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30', 10);
cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
  console.log(`[cron] Running scheduled HubSpot → Notion sync`);
  try {
    await syncHubSpotToNotion(200);
  } catch (err) {
    console.error('[cron] Sync failed:', err.message);
  }
});

// Daily digest log at 8am
cron.schedule('0 8 * * *', async () => {
  console.log('[cron] Daily digest:');
  try {
    const [overdueTasks, dueLeads] = await Promise.all([
      getOverdueTasks(),
      getLeadsDueForFollowUp(),
    ]);
    console.log(`  Overdue tasks: ${overdueTasks.length}`);
    console.log(`  Leads due for follow-up: ${dueLeads.length}`);
    dueLeads.forEach(l => {
      const name = l.properties.Name?.title?.[0]?.plain_text;
      const co = l.properties.Company?.rich_text?.[0]?.plain_text;
      console.log(`  → ${name} (${co})`);
    });
  } catch (err) {
    console.error('[cron] Digest failed:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sequence Minds CRM Sync running on port ${PORT}`);
  console.log(`   Syncing every ${intervalMinutes} minutes`);
});
