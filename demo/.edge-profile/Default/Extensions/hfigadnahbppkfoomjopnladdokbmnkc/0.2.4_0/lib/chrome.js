var app = {};

app.error = function () {
  return chrome.runtime.lastError;
};

app.popup = {
  "port": null,
  "message": {},
  "receive": function (id, callback) {
    if (id) {
      app.popup.message[id] = callback;
    }
  },
  "send": function (id, data) {
    if (id) {
      chrome.runtime.sendMessage({"data": data, "method": id, "path": "background-to-popup"}, app.error);
    }
  },
  "post": function (id, data) {
    if (id) {
      if (app.popup.port) {
        app.popup.port.postMessage({"data": data, "method": id, "path": "background-to-popup"});
      }
    }
  }
};

app.options = {
  "port": null,
  "message": {},
  "receive": function (id, callback) {
    if (id) {
      app.options.message[id] = callback;
    }
  },
  "send": function (id, data) {
    if (id) {
      chrome.runtime.sendMessage({"data": data, "method": id, "path": "background-to-options"}, app.error);
    }
  },
  "post": function (id, data) {
    if (id) {
      if (app.options.port) {
        app.options.port.postMessage({"data": data, "method": id, "path": "background-to-options"});
      }
    }
  }
};

app.storage = {
  "local": {},
  "read": function (id) {
    return app.storage.local[id];
  },
  "update": function (callback) {
    if (app.session) app.session.load();
    /*  */
    chrome.storage.local.get(null, function (e) {
      app.storage.local = e;
      if (callback) {
        callback("update");
      }
    });
  },
  "write": function (id, data, callback) {
    let tmp = {};
    tmp[id] = data;
    app.storage.local[id] = data;
    /*  */
    chrome.storage.local.set(tmp, function (e) {
      if (callback) {
        callback(e);
      }
    });
  },
  "load": function (callback) {
    const keys = Object.keys(app.storage.local);
    if (keys && keys.length) {
      if (callback) {
        callback("cache");
      }
    } else {
      app.storage.update(function () {
        if (callback) callback("disk");
      });
    }
  } 
};

app.on = {
  "management": function (callback) {
    chrome.management.getSelf(callback);
  },
  "uninstalled": function (url) {
    chrome.runtime.setUninstallURL(url, function () {});
  },
  "installed": function (callback) {
    chrome.runtime.onInstalled.addListener(function (e) {
      app.storage.load(function () {
        callback(e);
      });
    });
  },
  "startup": function (callback) {
    chrome.runtime.onStartup.addListener(function (e) {
      app.storage.load(function () {
        callback(e);
      });
    });
  },
  "connect": function (callback) {
    chrome.runtime.onConnect.addListener(function (e) {
      app.storage.load(function () {
        if (callback) callback(e);
      });
    });
  },
  "storage": function (callback) {
    chrome.storage.onChanged.addListener(function (changes, namespace) {
      app.storage.update(function () {
        if (callback) {
          callback(changes, namespace);
        }
      });
    });
  },
  "message": function (callback) {
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
      app.storage.load(function () {
        callback(request, sender, sendResponse);
      });
      /*  */
      return true;
    });
  }
};

app.tab = {
  "options": function () {
    chrome.runtime.openOptionsPage();
  },
  "get": function (tabId, callback) {
    chrome.tabs.get(tabId, function (e) {
      if (callback) callback(e);
    });
  },
  "remove": function (tabId, callback) {
    chrome.tabs.remove(tabId, function (e) {
      if (callback) callback(e);
    });
  },
  "restore": function (id, callback) {
    if (chrome.sessions) {
      chrome.sessions.restore(id, function (session) {
        let error = chrome.runtime.lastError;
        if (callback) {
          callback(session);
        }
      });
    }
  },
  "update": function (tabId, options, callback) {
    if (tabId) {
      chrome.tabs.update(tabId, options, function (e) {
        if (callback) callback(e);
      });
    } else {
      chrome.tabs.update(options, function (e) {
        if (callback) callback(e);
      });
    }
  },
  "open": function (url, index, active, callback) {
    const properties = {
      "url": url, 
      "active": active !== undefined ? active : true
    };
    /*  */
    if (index !== undefined) {
      if (typeof index === "number") {
        properties.index = index + 1;
      }
    }
    /*  */
    chrome.tabs.create(properties, function (tab) {
      if (callback) callback(tab);
    }); 
  },
  "on": {
    "removed": function (callback) {
      chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
        app.storage.load(function () {
          callback(tabId);
        }); 
      });
    },
    "updated": function (callback) {
      chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
        app.storage.load(function () {
          if (info && info.status) {
            callback(info, tab);
          }
        });
      });
    },
    "activated": function (callback) {
      chrome.tabs.onActivated.addListener(function (activeInfo) {
        app.storage.load(function () {
          chrome.tabs.get(activeInfo.tabId, function (tab) {
            let error = chrome.runtime.lastError;
            callback(tab ? tab : {"id": activeInfo.tabId});
          });
        });
      });
    }
  },
  "query": {
    "all": function (options, callback) {
      chrome.tabs.query(options ? options : {}, function (tabs) {
        let tmp = chrome.runtime.lastError;
        if (tabs && tabs.length) {
          callback(tabs);
        } else callback(undefined);
      });
    },
    "index": function (callback) {
      chrome.tabs.query({"active": true, "currentWindow": true}, function (tabs) {
        let tmp = chrome.runtime.lastError;
        if (tabs && tabs.length) {
          callback(tabs[0].index);
        } else callback(undefined);
      });
    },
    "closed": function (filter, callback) {
      if (chrome.sessions) {
        if (filter) {
          chrome.sessions.getRecentlyClosed(filter, function (sessions) {
            if (sessions && sessions.length) {
              callback(sessions);
            }
          });
        } else {
          chrome.sessions.getRecentlyClosed(function (sessions) {
            if (sessions && sessions.length) {
              callback(sessions);
            }
          });
        }
      }
    }
  },
  "reload": function (tabId, options, callback) {
    if (tabId) {
      if (options && typeof options === "object") {
        chrome.tabs.reload(tabId, options, function (e) {
          if (callback) callback(e);
        });
      } else {
        chrome.tabs.reload(tabId, {
          "bypassCache": options !== undefined ? options : false
        }, function (e) {
          if (callback) callback(e);
        }); 
      }
    } else {
      chrome.tabs.query({"active": true, "currentWindow": true}, function (tabs) {
        let tmp = chrome.runtime.lastError;
        if (tabs && tabs.length) {
          if (options && typeof options === "object") {
            chrome.tabs.reload(tabs[0].id, options, function (e) {
              if (callback) callback(e);
            });
          } else {
            chrome.tabs.reload(tabs[0].id, {
              "bypassCache": options !== undefined ? options : false
            }, function (e) {
              if (callback) callback(e);
            }); 
          }
        }
      });
    }
  }
};
