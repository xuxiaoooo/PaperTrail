import {existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

// Keep Firefox's registry inside PaperTrail, separate from the user's Firefox app.
export function browserLaunchOptions(type,options,platform=process.platform){
  if(platform!=='darwin'||type.name?.()!=='firefox')return options;
  const ini=resolve(dirname(type.executablePath()),'../Resources/browser/papertrail.ini');
  if(!existsSync(ini))throw new Error('Firefox 读取组件不完整，请重新安装 PaperTrail。');
  return {...options,env:{...process.env,...options.env,XUL_APP_FILE:ini}};
}
