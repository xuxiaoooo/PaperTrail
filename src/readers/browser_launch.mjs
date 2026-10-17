// Every portal uses the installed Google Chrome, with a separate profile per account.
export function chromeLaunchOptions(options={}){
  return {...options,channel:'chrome'};
}
