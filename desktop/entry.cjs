'use strict';
process.env.STUDYDASH_DESKTOP_EXE=process.execPath;
process.env.STUDYDASH_EDITION='ltn';
process.env.STUDYDASH_PORT ||= '47322';
require('electron').app.setName('StudyDash');
if (!require('./install.cjs').launchInstalled()) require('./main.cjs');
