var core = {
  "start": function () {
    core.load();
  },
  "install": function () {
    core.load();
  },
  "load": function () {
    /*  */
  },
  "forget": function (session) {
    if (browser && browser.sessions) {
      if (session.tab) {
        browser.sessions.forgetClosedTab(session.tab.windowId, session.tab.sessionId);
      } else {
        browser.sessions.forgetClosedWindow(session.window.sessionId);
      }
    }
  },
  "action": {
    "storage": function (changes, namespace) {
      /*  */
    },
    "options": {
      "store": function (e) {
        config.font.size = e.fontSize;
        config.max.results = e.maxResults;
      },
      "load": function () {
        app.options.send("storage", {
          "fontSize": config.font.size,
          "theme": config.options.theme,
          "maxResults": config.max.results
        });
      }
    },
    "popup": {
      "theme": function (e) {
        config.options.theme = e;
      },
      "load": function () {
        const options = {"maxResults": config.max.results};
        /*  */
        app.tab.query.closed(options, function (sessions) {    
          app.popup.send("storage", {
            "sessions": sessions,
            "fontSize": config.font.size,
            "theme": config.options.theme
          });
        });
      },
      "forget": async function () {
        if (browser && browser.sessions) {
          browser.sessions.getRecentlyClosed({}).then(function (sessions) {
            if (sessions && sessions.length) {
              for (let i = 0; i < sessions.length; i++) {
                core.forget(sessions[i]);
              }
              /*  */
              app.popup.send("reload");
            }
          });
        }
      },
      "restore": function (e) {
        if (e) {
          try {
            const id = e.ids.shift();
            const url = e.urls.shift();
            /*  */
            if (id) {
              app.tab.restore(id, function (session) {
                if (!session) {
                  if (url) {
                    app.tab.open(url);
                  } 
                }
              });
            } else if (url) {
              app.tab.open(url);
            }
            /*  */
            setTimeout(function () {
              if (e.ids.length) {
                core.action.popup.restore(e);
              }
            }, 300);
          } catch (e) {}
        }
      }
    }
  }
};

app.options.receive("load", core.action.options.load);
app.options.receive("store", core.action.options.store);

app.popup.receive("load", core.action.popup.load);
app.popup.receive("theme", core.action.popup.theme);
app.popup.receive("forget", core.action.popup.forget);
app.popup.receive("restore", core.action.popup.restore);
app.popup.receive("options", function () {app.tab.options()});
app.popup.receive("support", function () {app.tab.open(app.homepage())});
app.popup.receive("donation", function () {app.tab.open(app.homepage() + "?reason=support")});

app.on.startup(core.start);
app.on.installed(core.install);
app.on.storage(core.action.storage);
