## Webinar Leads Hub – Architecture Summary

### Backend (NestJS)

- **Tech**: NestJS, Mongoose, Winston logging, global `api/v1` prefix, CORS allowlist in `main.ts`.
- **Core Modules wired in `AppModule`**: Users, Auth, Attendees, Assignment, Webinar, Enrollments, Notes, Tags, Notification, Websocket, Attendee Log/Association, Plans/Subscription/Billing, Products/Revenue, Roles, Dashboard, etc.

#### Schemas Overview (MongoDB/Mongoose)

Located in `src/schemas/`:

- Attendee, Assignments, Attendee Association, Attendee Logs, Webinar, Webinar Participant, User, Roles
- Products, Product Level, Product Revenue
- Plans, Subscription, SubscriptionAddon, BillingHistory
- SidebarLinks, StatusDropdown, Tags, Notes, Notification, Notice Board
- Projects, Contacts, Location, LandingPage, FilterPreset, Custom Lead Type
- OTP, API Token, Counter, User Documents, WABA Tags, Expired Pabbly Token
- WhatsApp Embed (subfolder: `whatsapp-embed/campaign.schema.ts`)

Key models relevant to requested areas:

- Attendee (`Attendee.schema.ts`): email, firstName, lastName, phone, timeInSession, webinar (ref), isAttended, gender, location, adminId, assignedTo/tempAssignedTo, status, validCall, isPulledback, source, tags[], isDeleted. Indexed by email and composite `(adminId, webinar, isAttended, email)`.
- Assignments (`Assignments.schema.ts`): adminId, user (employee), webinar, attendee, recordType pre/post, status (active/inactive/completed/reassignrequested/reassignapproved), optional requestReason, isTemporary. Composite index `(adminId, webinar, attendee)`.

#### Attendees Module (`src/attendees`)

- Imports: `Attendee` model, Users, Subscription, Webinar, Assignment, Notification, Alarm, Enrollments, Notes, Attendee Association/Log, CustomLeadType, Websocket, WebinarParticipant, Tags.
- Middleware: Auth admin/token, compression, body filters; `GetAdminIdMiddleware` used for authenticated routes.

Endpoints (controller highlights):

- `GET /attendees/webinar` — Paginated webinar attendees with filters/sort; supports `isAttended`, `validCall`, assignmentType, leadType, selected fields.
- `GET /attendees/invalid-tags` — Returns invalid tags for admin.
- `GET /attendees/webinar-participants/:id` — Webinar participant set for admin+webinar.
- `GET /attendees/:email` — Lookup attendee by email for admin.
- `POST /attendees/grouped` and `GET /attendees/grouped` — Grouped attendees list for analytics (filters/sort, pagination on GET).
- `PUT /attendees/tag` — Bulk add a tag to emails (optionally scoped by webinar).
- `POST /attendees` — Import attendees (pre/post webinar); merges with existing, dedups, updates tags/phone, enforces subscription contact limits; emits websocket progress updates.
- `PATCH /attendees/:id` — Update attendee fields (name, phone, leadType, isAttended, gender, location, assignedTo, validCall, status, createdBy, webinarName).
- `PUT /attendees/swap` — Swap two fields across a filtered set.
- `DELETE /attendees/webinar` — Soft delete/hide specific attendees for a webinar.
- `DELETE /attendees/all` — Delete all attendee data by email list.

DTOs (`attendees.dto.ts`) cover create/import/update, filtering, grouped filters/sorting, export payloads, tag updates, swap, and deletion contracts.

Service (highlights):

- Import pipeline: contact limit checks, dedup by email, merge pre→post attributes/tags, backfill missing phone, transactional bulk updates/inserts, enrollment sync, websocket progress.
- Rich aggregation queries for webinar/grouped attendees, filtering on demographics/leadType/tags/status/enrollments/time ranges.
- Utilities: counts across webinars, invalid tags detection, phone formatting via AssignmentService, swap fields, tag updates.

#### Assignment Module (`src/assignment`)

- Imports: `Assignments` model, Users, Attendees, Webinar, Subscription, Notification, Enrollments, Attendee Log, Webinar Auto Message, Attendee Association.
- Middleware: Auth admin/active user, token guards, admin id for user activity, specific excludes for metrics/reassign fetch.

Endpoints (controller highlights):

- `POST /assignment/data/:empId` — Paginated employee assignments for a webinar with filters/sort; validates admin/employee relation; supports validCall flags.
- `POST /assignment/fetch-reassignments` — Admin view for reassign requests.
- `GET /assignment/activityInactivity` — Active/inactive assignment counts for employee.
- `POST /assignment` — Create assignment(s) to a specific employee or random assignment; validates role (Reminder for preWebinar, Sales for postWebinar) and daily contact limits.
- `POST /assignment/prewebinar` — Create/ensure pre-webinar assignment for a single attendee payload.
- `PATCH /assignment/reassign` — Employee requests reassignment (requires reason); tracked per webinar and attendee emails.
- `PUT /assignment/reassign` — Cancel reassignment request.
- `PATCH /assignment/reassign/approve` — Approve/resolve reassignment; can specify status/user.
- `PATCH /assignment/reassign/change` — Admin change assignment to different employee (temp/permanent).
- `PATCH /assignment/reassign/pullback` — Move to pullbacks (change assignment status by record type set).
- `POST /assignment/reassign/fetch` — Fetch reassignments by webinar, recordType, status with pagination.
- `GET /assignment/reassign/fetch` — Pullback request count for webinar+recordType.
- `GET /assignment/metrics/daily` — Employee daily metrics in date range (requires employeeId).
- `GET /assignment/metrics/all` — All assignments in date range (optional webinar).

DTOs (`Assignment.dto.ts`) define payloads for creating assignments, prewebinar creation, filtered fetching, export shapes, reassignment requests/approvals/changes, pullbacks, and date range queries.

Service (highlights):

- Aggregations joining Assignments→Attendee and attendee association/lead type; supports validCall filtering via per-user thresholds and Notes.
- Assignment creation flows (explicit/random), daily contact limit enforcement, reassignment request lifecycle, pullbacks transitions, metrics aggregations, and lead-type enriched projections.

### Frontend (React)

- **Tech**: React, React Router v6 (`createBrowserRouter`), Redux Toolkit + Persist, Sonner toasts, Socket.IO client with manual reconnect strategy.
- Entry (`main.jsx`): wires store, injects interceptors/utilities, renders `App` inside `PersistGate`.
- Sockets (`socket.js`): manual connect/disconnect and reconnection interval gated by auth state; `socketManager` exported for auth events.

#### Router & Pages

- Router is defined in `src/App.jsx` using `createBrowserRouter` with guarded routes via `RouteGuard` and role-based access.
- Auth: `/login` redirects based on `isUserLoggedIn`; global `Layout` under `/` with nested routes and `ErrorFallback`.
- Major routes:
  - `/` Dashboard
  - `/webinars` (ADMIN)
  - `/webinar-participants/:id` (ADMIN)
  - `/webinarDetails/:id` Webinar attendees (ADMIN)
  - `/clients`, `/add-client`, `/client/plan/:id`, `/view-client/:id` (SUPER_ADMIN)
  - `/employees`, `/employee/view/:id`, `/employee/edit/:id` (ADMIN)
  - `/assignments` (EMPLOYEE_SALES, EMPLOYEE_REMINDER)
  - `employee/assignments/:id` (ADMIN, with employeeModeData)
  - `/assignment-metrics` (conditional by plan, EMPLOYEE/ADMIN)
  - `/calendar` (conditional by plan)
  - `/products`, `/products/addProduct`, product revenue/enrollments (ADMIN)
  - `/plans`, `/plans/addPlan`, `/plans/editPlan/:id`, `/plans/order` (SUPER_ADMIN/ADMIN)
  - `/addons`, `/addons/:id` (ADMIN/SUPER_ADMIN)
  - `/notifications/:userId`, `/user-downloads`
  - `/settings`, `/settings/custom-status` (feature-flag + role)
  - `/lead-type`, `/tags`, `/locations`, `/locations/requests`
  - `/notice-board`, `/notice-board/update`
  - `/admin-logs`
  - fallback: `/*` → ComingSoon, `*` → NotFound

Pages directory (`src/pages/`) contains feature folders: Assignments, Attendees, Auth, Calendar, Clients, Contacts, Dashboard, Employees, Location, NoticeBoard, Notifications, Products, Profile, Revenue, Settings (Addons, Billing, CustomOptions, LandingPage, LeadType, Plans, SidebarLinks, Tags), Webinar (including Participants), plus `index.js` aggregator.

### Notable Cross-Cutting Concerns

- Middlewares: AuthAdmin/AuthToken/GetAdminId, validation for filters, compression where relevant.
- Logging: Winston console + daily rotated files (application and error logs).
- CORS: allowlist with dev domains and production subdomains; credentials enabled.
- Realtime: Websocket gateway broadcasts progress (e.g., import/export) and notifications; frontend subscribes to `notification` and `log-out` events and joins user rooms.

### Suggested Entry Points for Further Work

- Backend: `src/attendees/attendees.controller.ts`, `src/attendees/attendees.service.ts`, `src/assignment/assignment.controller.ts`, `src/assignment/assignment.service.ts`, relevant DTOs, and schemas.
- Frontend: `src/App.jsx` for routes/guards, `src/pages/` for feature views, `src/socket.js` for realtime wiring.


