# M Phase RFQ Builder

## Team authentication setup

The app uses Supabase Auth for sign-in and database row-level security (RLS) for authorization. Do not deploy the code before completing the database setup below: the app expects the `app_members` table and the role policies created by the migration.

1. In Supabase **Authentication → URL Configuration**, set the app's site URL and allow the deployed app's `/login` URL for invitation redirects.
2. Keep public sign-up disabled, then create or invite the first administrator from **Authentication → Users**.
3. Apply [`supabase/migrations/20261103220000_phase2_auth_and_roles.sql`](./supabase/migrations/20261103220000_phase2_auth_and_roles.sql) in the Supabase SQL Editor.
4. Assign the initial admin role in the SQL Editor, replacing the email with the exact administrator email:

   ```sql
   INSERT INTO public.app_members (user_id, role, assigned_by)
   SELECT id, 'ADMIN', id
   FROM auth.users
   WHERE lower(email) = lower('admin@your-company.com')
   ON CONFLICT (user_id, role) DO NOTHING;
   ```

   Confirm that exactly one row was inserted or already exists before signing in. The application cannot grant the first administrator role itself.
5. Configure the app's server environment with `SUPABASE_SERVICE_ROLE_KEY` for administrator invitations and role management. This is a secret: never use a `NEXT_PUBLIC_` prefix or expose it to browser code.
6. Deploy the app, sign in as the initial admin, and invite the rest of the team from **Team access**.

The existing Supabase URL and anon-key environment variables remain `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Keep the tested database backup available before applying the migration. The migration replaces the existing public table policies with authenticated role-based policies; after it is applied, unauthenticated access to the app data is denied.

## Vendor quote capture

After the authentication migration is active, apply [`supabase/migrations/20261103220100_vendor_quote_capture.sql`](./supabase/migrations/20261103220100_vendor_quote_capture.sql) in the Supabase SQL Editor. It adds quote headers and independent material snapshots, including unit prices and freight/tax/other charges. The quote total is calculated from priced line items plus those charges. Blank unit prices are retained as unpriced lines rather than treated as zero.

RFQ Managers and Admins can record and delete quotes; all roles can view and compare them. Open a project, then choose **Vendor Quotes**. A recorded quote is independent from later takeoff edits.

RFQ Managers and Admins can also start an RFQ from the dashboard by choosing its project and selecting **Create RFQ**; the project RFQ wizard opens directly without first opening the project card.

The RFQ dispatch wizard and list of vendor drafts opened are preserved for the current browser tab session. The “Draft opened” indicator confirms that the email draft was opened from the app; Gmail does not report whether it was sent.

## Material budgets and invoice extraction

After the authentication and quote migrations are active, apply [`supabase/migrations/20261103220200_project_budgets_and_invoices.sql`](./supabase/migrations/20261103220200_project_budgets_and_invoices.sql) in the Supabase SQL Editor. It adds a manually editable project material budget, immutable invoice records and line-item snapshots, voiding with a reason, and a private `project-invoices` Supabase Storage bucket.

After applying that migration, also apply [`supabase/migrations/20261104131000_allow_zero_invoice_quantities.sql`](./supabase/migrations/20261104131000_allow_zero_invoice_quantities.sql). It allows zero quantities on invoice details and stores extracted actual line costs separately.

Admins and Cost Editors can set a project budget and record invoices. Invoice line details do not count as separate expenses: only the posted invoice header total is subtracted from the budget. A voided invoice remains visible but is excluded from expense totals. Invoice files are stored privately in Supabase and available to signed-in team members using short-lived signed links.

Invoice upload uses Google Cloud Document AI's Invoice Parser. Enable the Document AI API and billing, create an Invoice Parser processor, and configure Vercel-to-Google Workload Identity Federation (WIF). WIF uses short-lived credentials and does not require downloading a service-account key.

1. In Vercel **Settings → Security**, enable OpenID Connect (OIDC). Use the team issuer mode and note your Vercel team slug and project name.
2. In Google Cloud **IAM & Admin → Workload Identity Federation**, create a pool in the global location and an OIDC provider. Use the team issuer URL `https://oidc.vercel.com/YOUR_VERCEL_TEAM_SLUG`, select the provider's default audience, and map `google.subject` to `assertion.sub`.
3. Restrict the provider with an attribute condition for only this production deployment: `assertion.sub == 'owner:YOUR_VERCEL_TEAM_SLUG:project:YOUR_VERCEL_PROJECT_NAME:environment:production'`.
4. Create a Google service account. Grant it **Document AI API User** (`roles/documentai.apiUser`) on the Google Cloud project.
5. Grant the Vercel production subject `principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/subject/owner:YOUR_VERCEL_TEAM_SLUG:project:YOUR_VERCEL_PROJECT_NAME:environment:production` the **Workload Identity User** (`roles/iam.workloadIdentityUser`) role on that service account. This allows only that Vercel production deployment to impersonate it.
6. Add the following server-only variables to Vercel. Copy `GCP_AUDIENCE` from the provider details page; it should use the provider's default audience URL.

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | Google Cloud project ID that owns the processor |
| `GCP_PROJECT_NUMBER` | Numeric Google Cloud project number |
| `GCP_SERVICE_ACCOUNT_EMAIL` | Email address of the service account |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | Workload identity pool ID |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | OIDC provider ID |
| `GCP_AUDIENCE` | Default audience URL shown in the provider details |
| `GOOGLE_DOCUMENT_AI_LOCATION` | Processor location, such as `us` or `eu` |
| `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` | Invoice Parser processor ID |

Do not create or upload a service-account key. These variables are identifiers, not secrets; never add a `NEXT_PUBLIC_` prefix. Redeploy after setting them. Invoice PDFs/images are sent to Google Document AI for extraction; Google Cloud charges and data-processing terms apply.

Open a project and choose **Material Costs** to set its budget, upload a PDF or image invoice (20 MB maximum), and let Document AI extract vendor, invoice date/number/total, and line items. The extracted description is preferred over a product code. Extracted unit prices are rounded to two decimal places; actual line amounts are preserved separately. Missing quantities are estimated from line amount and unit price when possible; a quantity extracted as zero is kept as zero and is allowed when recording. If a quantity cannot be determined, it is left blank while the extracted line amount is preserved, and a quantity is required before recording. Extracted sales tax is shown as a separate invoice line. Review and correct the extracted fields before recording. An in-progress upload and its extracted draft are saved in the current browser tab session so you can leave the page and return without re-uploading. Only the invoice total is counted once against the project budget; line-item details are not separate expenses.

For local extraction testing, link the workspace to its Vercel project and run `vercel env pull` to retrieve local development variables, including Vercel's OIDC token. The Google identity condition above intentionally permits only the production environment; use a separate restricted identity binding if local or preview extraction is needed.

## Submittal tracking

After the authentication migration is active, apply [`supabase/migrations/20261107170000_submittals_core.sql`](./supabase/migrations/20261107170000_submittals_core.sql) in the Supabase SQL Editor. It creates project submittals, revision records, and append-only activity history. Open a project and choose **Submittals** to create and track Rev 0, record manual sends and responses, create or void revisions, and review the activity log. Submittal status is derived from its revisions; names and item numbers are unique within each project.

After the core submittal migration, apply [`supabase/migrations/20261107173000_submittal_drive_documents.sql`](./supabase/migrations/20261107173000_submittal_drive_documents.sql). It adds project Drive-folder links and revision-specific document references. Documents remain in Google Drive; the app stores links and metadata only. In each submittal's **Documents** tab, attach files using the Picker or paste a Drive file URL. Links are grouped by revision, and each file can be previewed or opened in Drive.

To enable Google Drive Picker, enable the Google Picker API in a Google Cloud project, create a browser API key restricted to your deployed app's HTTP referrers and the Picker API, and create a Web OAuth client with your app's origins configured. Add these public client identifiers to local development and the production app environment:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | Referrer-restricted Google API key |
| `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | Google OAuth Web client ID |

Picker requests only the `drive.file` scope, which grants the app access to files the user selects for this app. No file contents are uploaded or stored by the app. If Picker is not configured, manually pasting a Drive URL remains available.

The current submittal phase supports manual send tracking and Drive document links. Gmail draft confirmation, follow-ups, RFIs, and import/export remain planned for later phases. The existing RFQ compose-URL feature does not use Gmail scopes.

## Roles

Roles can be combined:

| Role | Access |
| --- | --- |
| Admin | Manage all app data, invite users, and assign roles |
| RFQ Manager | Create projects, edit material takeoffs, manage suppliers, and create/manage RFQs and submittals |
| Reviewer | View project takeoffs, RFQ history, submittals, and vendor quote comparisons |
| Cost Editor | View all data; set manual material budgets, record invoices, and void invoices |
| Viewer | Read-only access to project, RFQ, quote, budget, and invoice data |

Database policies are the security boundary. Hiding controls in the UI is only for usability.

## Local development

Install dependencies and configure the Supabase environment variables, then run:

```bash
npm run dev
```

Use `npm run lint`, `npm test`, and `npx tsc --noEmit` to validate changes.
