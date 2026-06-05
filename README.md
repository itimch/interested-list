# Sequence Minds — Lead Command Center

Mini CRM sync layer that keeps HubSpot ↔ Notion in sync and captures Smartlead webhook events in real time.

## What it does

- **Syncs HubSpot contacts → Notion** every 30 minutes (configurable)
- **Receives Smartlead webhooks** — when a lead replies to an email, it's instantly logged in Notion and a follow-up task is created
- **Daily digest** at 8am — logs all overdue tasks and leads due for follow-up
- **REST API** — trigger manual syncs or pull a digest from any tool

## Setup

### 1. Copy env file and fill in your keys

```bash
cp .env.example .env
```

| Variable | Where to get it |
|---|---|
| `HUBSPOT_ACCESS_TOKEN` | HubSpot → Settings → Private Apps → Create app |
| `NOTION_TOKEN` | Notion → Settings → Integrations → New integration |
| `NOTION_LEADS_DB` | Already set — `34ff5c3a-b78a-403a-935c-4b3ab060a85e` |
| `NOTION_TASKS_DB` | Already set — `5066e3c5-e2d0-4756-85aa-f8005ffb8c77` |
| `SMARTLEAD_API_KEY` | Smartlead → Settings → API |
| `SMARTLEAD_WEBHOOK_SECRET` | Smartlead → Webhooks → set a secret |

### 2. Share Notion databases with your integration

In Notion, open each database → Share → Invite your integration by name.

### 3. Install and run

```bash
npm install
npm start
```

### 4. Point Smartlead webhooks at your server

In Smartlead → Settings → Webhooks, add:
```
POST https://your-server.com/webhooks/smartlead
```

Events to subscribe: `EMAIL_REPLY`, `EMAIL_OPENED`

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/sync/hubspot` | Trigger manual HubSpot → Notion sync |
| `GET` | `/digest` | Get today's follow-up list (JSON) |
| `POST` | `/webhooks/smartlead` | Smartlead webhook receiver |

## Notion databases

| Database | ID |
|---|---|
| Leads | `34ff5c3a-b78a-403a-935c-4b3ab060a85e` |
| Tasks | `5066e3c5-e2d0-4756-85aa-f8005ffb8c77` |

Notion workspace: [Sequence Minds — Lead Command Center](https://app.notion.com/p/376346f2c9c88140bf0dd3e42cd6d36f)

## File structure

```
src/
  server.js      — Express app + cron jobs
  sync.js        — HubSpot → Notion sync logic
  hubspot.js     — HubSpot API client
  notion.js      — Notion API client (upsert leads, create tasks)
  smartlead.js   — Smartlead webhook handler
```
