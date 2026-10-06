// Submit existing credentials only to the IEEE identity pages used by this portal.
const identityHost = url => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      (/^(?:www|signin|services\d+)\.ieee\.org$/.test(parsed.hostname) ||
       parsed.hostname === 'ieee-rex.scienceconnect.io');
  } catch { return false; }
};

export async function advanceIeeeLogin(page, input, progress) {
  for (const frame of page.frames()) {
    if (!identityHost(frame.url())) continue;
    const password = frame.locator('input[type="password"]').first();
    const submit = frame.getByRole('button', {name:/^(?:sign[ -]?in|log[ -]?in)$/i}).first();
    const connectSubmit = frame.locator('#sign-in-btn').first();
    // The portal may first open IEEE's registration page, which also has password fields.
    // Its existing-account link leads to the SAML sign-in form.
    if (!progress.signInOpened && new URL(frame.url()).hostname === 'www.ieee.org') {
      const signIn = frame.getByRole('link', {name:/^sign in\b/i}).first();
      if (await signIn.isVisible().catch(() => false) && !await submit.isVisible().catch(() => false)) {
        progress.signInOpened = true;
        await signIn.click({noWaitAfter:true});
        return;
      }
    }
    if (await password.isVisible().catch(() => false) && !progress.passwordSubmitted) {
      const username = frame.locator('input[type="email"], input[name="username"], input[name="email"], input[name="UserName"], #username, #email-input').first();
      const button = await submit.isVisible().catch(() => false) ? submit : connectSubmit;
      if (!await button.isVisible().catch(() => false)) continue;
      if (await username.isVisible().catch(() => false)) await username.fill(input.username);
      await password.fill(input.password);
      input.password = '';
      progress.passwordSubmitted = true;
      await button.click({noWaitAfter:true});
    } else if (!progress.emailSubmitted && !progress.passwordSubmitted) {
      const email = frame.locator('#email-input').first();
      if (await email.isVisible().catch(() => false) && await connectSubmit.isVisible().catch(() => false)) {
        await email.fill(input.username);
        progress.emailSubmitted = true;
        await connectSubmit.click({noWaitAfter:true});
      }
    }
    if (await frame.getByText(/(?:incorrect|invalid).{0,60}(?:password|username|credentials)|(?:password|username).{0,60}(?:incorrect|invalid)|do not match our records/i).first().isVisible().catch(() => false))
      throw new Error('credentials_rejected');
  }
}
