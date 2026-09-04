// Importing test modules directly avoids spawning child processes in restricted development shells.
await import("./phase_1_foundation.test.mjs");
await import("./phase_2_contacts.test.mjs");
await import("./phase_3_crm.test.mjs");
await import("./phase_4_imports.test.mjs");
await import("./phase_5_mailboxes.test.mjs");
await import("./phase_5_campaign_boundary.test.mjs");
await import("./phase_6_sequence_configuration.test.mjs");
