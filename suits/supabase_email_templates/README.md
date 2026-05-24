# Suits AI — Branded Supabase Auth Email Templates

These HTML templates replace the default Supabase auth emails (the ones that
ship with a "Supabase Auth" header) with the Suits AI brand palette: cream
background, orange accent, dark text.

## Files

| File | Supabase template slot |
| --- | --- |
| `confirm_signup.html` | Confirm signup |
| `magic_link.html` | Magic Link |
| `reset_password.html` | Reset Password |
| `email_change.html` | Change Email Address |
| `invite.html` | Invite user |
| `reauthentication.html` | Reauthentication (OTP code) |

## How to install

1. Open the Supabase Dashboard → your project → **Authentication** →
   **Email Templates**.
2. For each template slot above, copy the contents of the corresponding HTML
   file and paste it into the **Message body** field. Keep the **Subject**
   field as you prefer (suggestions below).
3. Click **Save changes**.

### Suggested subject lines

- **Confirm signup** — `Confirm your Suits AI account`
- **Magic Link** — `Your Suits AI sign-in link`
- **Reset Password** — `Reset your Suits AI password`
- **Change Email Address** — `Confirm your new Suits AI email`
- **Invite user** — `You're invited to Suits AI`
- **Reauthentication** — `Suits AI verification code: {{ .Token }}`

## Template variables used

The templates rely on the standard Supabase substitutions:

- `{{ .ConfirmationURL }}` — full action URL (used by confirm, magic link,
  reset, email change, invite)
- `{{ .Token }}` — 6-digit OTP (reauthentication)
- `{{ .Email }}` / `{{ .NewEmail }}` — old/new addresses in the email-change
  flow

If you change the URL configuration in Supabase (Site URL / Redirect URLs),
no template edits are needed — Supabase substitutes the right URL at send
time.

## Customising

- **Logo:** the templates use a text "SUITS AI" pill instead of an `<img>`
  to avoid hotlinking. To add an image, host your logo at a public HTTPS URL
  (e.g. the Supabase Storage public bucket) and replace the pill markup with:
  `<img src="https://your-host/logo.png" alt="Suits AI" width="32" height="32" style="display:block;border-radius:8px;" />`.
- **Colors:** the accent orange is `#DA6B2B` (suits-500) and the cream
  background is `#FAF9EA` — find/replace if you want a different palette.
- **Font:** uses the platform UI stack (San Francisco on macOS/iOS, Segoe on
  Windows) so emails render natively without web-font requests.

## Testing

Use Supabase's **Send test email** button on the Email Templates page, or
trigger the flow in the app (sign up with a new address, request a password
reset, etc.). Most clients (Gmail, Outlook web, Apple Mail) render the
templates correctly; the table-based layout is intentional for compatibility
with Outlook desktop.
