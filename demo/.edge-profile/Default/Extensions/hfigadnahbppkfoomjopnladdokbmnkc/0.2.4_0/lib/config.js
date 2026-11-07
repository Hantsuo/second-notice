var config = {};

config.welcome = {
  set lastupdate (val) {app.storage.write("lastupdate", val)},
  get lastupdate () {return app.storage.read("lastupdate") !== undefined ? app.storage.read("lastupdate") : 0}
};

config.font = {
  set size (val) {app.storage.write("font-size", val)},
  get size () {return app.storage.read("font-size") !== undefined ? app.storage.read("font-size") : 13}
};

config.max = {
  set results (val) {app.storage.write("max-results", val)},
  get results () {return app.storage.read("max-results") !== undefined ? app.storage.read("max-results") : 25}
};

config.options = {
  set theme (val) {app.storage.write("theme", val)},
  get theme () {return app.storage.read("theme") !== undefined ? app.storage.read("theme") : "light"},
}
