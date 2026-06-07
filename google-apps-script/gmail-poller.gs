/**
 * Sequence Minds — Gmail Lead Reply Poller
 *
 * Setup:
 * 1. Go to script.google.com → New project
 * 2. Paste this script
 * 3. Set SYNC_SERVER_URL to your deployed server URL
 * 4. Run setupTrigger() once to activate the 5-minute polling
 */

var SYNC_SERVER_URL = 'https://your-server.com'; // Replace with your actual server URL
var LAST_RUN_KEY = 'gmail_poller_last_run';

/**
 * Run once to set up the 5-minute recurring trigger.
 */
function setupTrigger() {
  // Remove existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pollGmailForLeadReplies') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('pollGmailForLeadReplies')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Trigger set up — polling every 5 minutes.');
}

/**
 * Main polling function — called every 5 minutes by the trigger.
 */
function pollGmailForLeadReplies() {
  var props = PropertiesService.getScriptProperties();
  var lastRun = props.getProperty(LAST_RUN_KEY);

  // Default: look back 10 minutes on first run
  var lookbackDate = lastRun
    ? new Date(parseInt(lastRun))
    : new Date(Date.now() - 10 * 60 * 1000);

  var after = Utilities.formatDate(lookbackDate, 'UTC', 'yyyy/MM/dd');

  // Search for replies in inbox — exclude newsletters, notifications, internal
  var query = [
    'in:inbox',
    'after:' + after,
    '-from:noreply',
    '-from:no-reply',
    '-from:notifications',
    '-from:sequenceminds.com',
    '-from:gmail.com',
    '-from:accounts.google.com',
    '-category:promotions',
    '-category:updates',
    '-category:social'
  ].join(' ');

  var threads = GmailApp.search(query, 0, 20);
  Logger.log('Found ' + threads.length + ' threads since ' + lookbackDate);

  var processed = 0;
  threads.forEach(function(thread) {
    var messages = thread.getMessages();
    messages.forEach(function(msg) {
      // Only process messages newer than last run
      if (msg.getDate() <= lookbackDate) return;
      // Skip messages sent by us
      if (msg.getFrom().indexOf('itimchevski@sequenceminds.com') !== -1) return;
      if (msg.getFrom().indexOf('ivan.timchevski.55@gmail.com') !== -1) return;

      var from = msg.getFrom();
      var email = extractEmail(from);
      var name = extractName(from);

      if (!email) return;

      var payload = {
        fromEmail: email,
        fromName: name,
        subject: msg.getSubject(),
        snippet: msg.getPlainBody().substring(0, 300),
        date: msg.getDate().toISOString()
      };

      try {
        var response = UrlFetchApp.fetch(SYNC_SERVER_URL + '/webhooks/gmail', {
          method: 'POST',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        var result = JSON.parse(response.getContentText());
        if (result.handled) {
          Logger.log('Lead reply logged: ' + email + ' — ' + msg.getSubject());
          processed++;
        }
      } catch (e) {
        Logger.log('Error sending to sync server: ' + e.message);
      }
    });
  });

  // Save timestamp for next run
  props.setProperty(LAST_RUN_KEY, Date.now().toString());
  Logger.log('Done. Processed ' + processed + ' lead replies.');
}

/**
 * Extract email address from "Name <email>" format.
 */
function extractEmail(from) {
  var match = from.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  if (from.indexOf('@') !== -1) return from.trim().toLowerCase();
  return null;
}

/**
 * Extract display name from "Name <email>" format.
 */
function extractName(from) {
  var match = from.match(/^(.+?)\s*</);
  if (match) return match[1].replace(/"/g, '').trim();
  return from.split('@')[0];
}

/**
 * Test function — run manually to verify setup.
 */
function testPoller() {
  Logger.log('Testing poller...');
  Logger.log('Server URL: ' + SYNC_SERVER_URL);

  // Test server health
  try {
    var res = UrlFetchApp.fetch(SYNC_SERVER_URL + '/', { muteHttpExceptions: true });
    Logger.log('Server response: ' + res.getContentText());
  } catch (e) {
    Logger.log('Could not reach server: ' + e.message);
  }
}
