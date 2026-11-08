# Groundskeeper operations workspace

The existing vanilla JavaScript, HTML and CSS application is retained. The new project model and screens use the same job records as imports, maps, pricing, daily planning and crew reporting. No framework migration or new runtime dependency is required.

## Design choices

- Today leads with assignments and actionable exceptions. Routing, weather and cost context follow the day's schedule.
- The weekly board uses crew rows and weekday columns. Busy desktop cells scroll within a bounded row so both crews remain visible. The unscheduled list retains visits that need estimates, map information, availability or capacity.
- Phones use day tabs and full-width assignments. Project tables become labeled cards; detailed category comparisons remain horizontally scrollable, with expandable breakdowns below. Additional tools are available through More.
- Projects use a restrained title, property information and four tabs. Costs separate spending to date from open commitments and additional work. Text labels accompany status colors, keyboard focus remains visible, and tabs support arrow, Home and End keys.
- The warm neutral background, white surfaces and forest-green accent retain Groundskeeper's identity. Amber marks scheduling review and red marks unfavorable cost variance.

## References inspected

- [Jobber's week schedule](https://help.getjobber.com/en/articles/week-view-of-the-schedule-new-schedule/): inspected the accessible schedule screenshot, including week columns, filters and the unscheduled-work sidebar.
- [Float's product tour](https://www.float.com/product-tour): inspected visible capacity and assignment preview images. The interactive lightbox loaded a blank embedded frame, so its interactions were not inspected.
- [Linear projects](https://linear.app/docs/projects): inspected the official project screenshot and its hierarchy of title, properties and updates.
- [Mercury's demo](https://demo.mercury.com/dashboard): inspected the loaded application, financial summaries and tables. No account or payment actions were performed.
- [Buildxact's job overview](https://help.buildxact.com/en/articles/17456836-job-overview-tab): read the cost terminology and explanation. The embedded video was not available to inspect.

No reference-product screenshots, logos or proprietary interface assets are shipped in this application.

## Validation

The automated suite covers existing pricing, intake, geocoding, routing and staffing behavior, plus project migration, exact financial reconciliation, overdue balances, atomic assignment validation, unavailable crews and missing actual time. It preserves reviewed prices and reported visits and does not introduce a fixed five-job target.

Browser checks cover project and schedule search, project selection and tabs, expandable cost categories, forecast editing and refresh persistence, valid rescheduling and conflict errors, crew availability and affected backlog records, project notes, CSV review and import, manual address lookup and the price form. Desktop and phone layouts are inspected for overflow and usable navigation. Native Excel parsing remains covered by the intake tests; the browser's native file picker did not expose a selectable automation event in this environment.

## Prototype limits

Data saves to the signed-in owner's private business account. Projects and invoices are a sample ledger, not connected accounting records. Scheduling compares estimated road travel and existing shift constraints; it is a heuristic and does not guarantee a global optimum. Address matches and weather require internet access and remain estimates. Field progress is a manual check-in, not live GPS. Completion messages are drafts; no customer email is sent.
