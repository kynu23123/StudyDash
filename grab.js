(function () {
  /* StudyDash "Send to StudyDash" bookmark. Reads the page the student already has open
     (Google Classroom, PowerSchool or Genesis) and hands it to the StudyDash app on this computer. */
  /*READER*/
  var out = __sdRead();
  if (!out.courses.length && !out.items.length && !out.tasks.length && !(out.mail && out.mail.length) && !(out.formulas && out.formulas.length)) {
    alert('StudyDash didn\'t find anything to import on this page.\n\nOpen your Classroom To-do page, your grades page, a class\'s assignment list, or your Outlook inbox, then click the bookmark again.');
    return;
  }
  var json = JSON.stringify(out);
  var b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  var w = window.open('http://127.0.0.1:__PORT__/import#' + b64, '_blank');
  if (!w) alert('Your browser blocked the StudyDash window. Allow pop-ups for this site, then click the bookmark again.');
})();
