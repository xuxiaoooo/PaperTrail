export function ieeeLoginFailure({emptyLoginResponse=false,title=''}) {
  return emptyLoginResponse || /just a moment|请稍候|verify|access denied|security check/i.test(title)
    ? 'verification_required' : 'login_incomplete';
}
