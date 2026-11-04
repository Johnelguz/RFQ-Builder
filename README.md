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

## Roles

Roles can be combined:

| Role | Access |
| --- | --- |
| Admin | Manage all app data, invite users, and assign roles |
| RFQ Manager | Create projects, edit material takeoffs, manage suppliers, and create/manage RFQs |
| Reviewer | View project takeoffs, RFQ history, and vendor quote comparisons |
| Cost Editor | View project, RFQ, and vendor quote data; budget and invoice editing will be added in a later phase |
| Viewer | Read-only access to project, RFQ, and vendor quote data |

Database policies are the security boundary. Hiding controls in the UI is only for usability.

## Local development

Install dependencies and configure the Supabase environment variables, then run:

```bash
npm run dev
```

Use `npm run lint` and `npx tsc --noEmit` to validate changes.
