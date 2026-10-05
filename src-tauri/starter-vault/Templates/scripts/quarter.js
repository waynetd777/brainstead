// Example template script: the Weekly plan template calls it as tp.user.quarter("2026-10-05").
// Each .js file in Templates/scripts (the folder is set in Settings › Notes) is tp.user.<its name>,
// and module.exports is what the template calls. Delete it with the Weekly plan template.
module.exports = function (date) {
  const [y, m, d] = String(date).split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  const days = Math.round((Date.UTC(y, q * 3 + 3, 1) - Date.UTC(y, m - 1, d)) / 86400000);
  return `Q${q + 1} ${y}: ${days} days left in the quarter.`;
};
