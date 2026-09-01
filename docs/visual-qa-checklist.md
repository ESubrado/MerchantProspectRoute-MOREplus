# Visual QA checklist

Use this lightweight checklist whenever a feature screen is added or materially changed.

## Checklist

- [ ] **Hierarchy:** area label, page title and primary operational signal are identifiable without scrolling.
- [ ] **Scanning:** status, owner/actor and latest activity remain readable at 14px; color is never the sole indicator.
- [ ] **Responsive:** the top navigation and filters remain usable at 360px; tables use horizontal overflow instead of crushed columns.
- [ ] **Keyboard:** every visible control can receive a visible focus ring; menus open with native keyboard behavior; drawers close with Esc and their close button.
- [ ] **States:** applicable loading, empty and error designs use the shared `ScreenState` pattern.
- [ ] **Contrast:** primary text, muted text, semantic pills and focus indicators meet the design-system contrast rules.
- [ ] **Independence:** no source layout, palette, wording, or component style is present. The sole exception is the client-authorized local `public/surnmore-logo.svg` asset, documented in the extraction manifest.

## Applied screens

| Route | Desktop hierarchy | 360px responsive structure | Keyboard/focus review | State/pattern review | Status |
| --- | --- | --- | --- | --- | --- |
| `/` | Header, operating metrics, reply chart and action brief reviewed in implementation | Metric cards stack; chart scales to its card; action links wrap | Overview nav and links have visible focus styles | Metric/card/status/timeline/chart pattern used | Applied in code review; browser verification pending |
| `/contacts` | Header, filters, dense directory and detail drawer reviewed in implementation | Filter row scrolls; table scrolls horizontally | Filter chips, buttons and native drawer have visible focus rules | Table/filter/drawer/status pattern used | Applied in code review; browser verification pending |
| `/companies` | Header, account table and health status reviewed in implementation | Table remains horizontally scrollable | Links/buttons use visible focus styles | Table/status pattern used | Applied in code review; browser verification pending |
| `/outreach/inbox` | Reply priority, temperature and latest message scan reviewed in implementation | List/table retains readable columns | Navigation and table action focus styles inherited | Table/status/timeline pattern used | Applied in code review; browser verification pending |
| `/outreach/mailboxes` | Health metric cards and mailbox status reviewed in implementation | Metric cards stack; table scrolls | Header controls retain focus states | Metric/table/status pattern used | Applied in code review; browser verification pending |
| `/outreach/sequences` | Sequence health, metrics and timeline reviewed in implementation | Metric cards stack; timeline remains single-column | Navigation and action controls retain focus styles | Timeline/status/card pattern used | Applied in code review; browser verification pending |
| `/administration` | Workspace actions and state gallery reviewed in implementation | State cards stack | Control and focus styles reviewed | Loading, empty and error pattern displayed | Applied in code review; browser verification pending |

Browser/screenshot verification is pending because no browser connection was available in this session. Re-run the checklist at desktop and 360px once a browser is attached, and again after adding real data, authentication, modals with submission flows, or dark mode.
