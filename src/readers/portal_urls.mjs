// Recognize journal-specific ScholarOne entries independently of the journal name.
export function isScholarOneUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^mc\d*\.manuscriptcentral\.com$/.test(url.hostname) &&
      /^\/[A-Za-z0-9][A-Za-z0-9_-]*\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isEditorialManagerUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.editorialmanager.com' && !url.username && !url.password &&
      /^\/[A-Za-z0-9_-]+(?:\/(?:default2?\.aspx|login\.asp))?\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isWileyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['authors.wiley.com','submission.wiley.com'].includes(url.hostname) &&
      /^\/(?:dashboard\/)?journal\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isIeeePortalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.hostname === 'ieee.submission.researchexchange.com' &&
      /^\/submission(?:\/dashboard(?:\/[A-Za-z0-9_-]+)?)?\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}
