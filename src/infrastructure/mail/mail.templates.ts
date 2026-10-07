/** Plain, provider-agnostic templates. Swap for MJML/React Email later without touching callers. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Machine-readable kind, handy for tests and provider tagging. */
  kind: 'verify-email' | 'reset-password' | 'change-email' | 'invitation' | 'account-exists';
  /** The primary action link, if any. */
  link?: string;
}

export const templates = {
  verifyEmail: (to: string, name: string, link: string): MailMessage => ({
    to, kind: 'verify-email', link,
    subject: 'Confirm your Servio email',
    text: `Hi ${name},\n\nConfirm your email to finish setting up Servio:\n${link}\n\nIf you didn't sign up, ignore this email.`,
  }),
  resetPassword: (to: string, link: string): MailMessage => ({
    to, kind: 'reset-password', link,
    subject: 'Reset your Servio password',
    text: `Reset your password using this link (valid for 1 hour):\n${link}\n\nIf you didn't ask for this, ignore this email.`,
  }),
  changeEmail: (to: string, newEmail: string, link: string): MailMessage => ({
    to, kind: 'change-email', link,
    subject: 'Approve your Servio email change',
    text: `A request was made to change your Servio login email to ${newEmail}.\nApprove it here:\n${link}\n\nIf this wasn't you, change your password now.`,
  }),
  invitation: (to: string, restaurant: string, role: string, inviter: string, link: string): MailMessage => ({
    to, kind: 'invitation', link,
    subject: `You're invited to ${restaurant} on Servio`,
    text: `${inviter} invited you to join ${restaurant} as ${role}.\nAccept the invitation (valid for 7 days):\n${link}`,
  }),
  accountExists: (to: string, loginLink: string, resetLink: string): MailMessage => ({
    to, kind: 'account-exists',
    subject: 'You already have a Servio account',
    text: `Someone (hopefully you) tried to register with this email, but it already has an account.\nSign in: ${loginLink}\nForgot your password? ${resetLink}`,
  }),
};
