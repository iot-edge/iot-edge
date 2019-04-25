$(function() {

  // Allow dashboard to run independently for panel images (alerts & reports)
  if (document.location.toString().match(/d-solo.*panelId=/)) {
    $('body').removeClass('edge');
    return;
  }

  var bootData = window.grafanaBootData;
  var ioListeners = [];
  var grafanaUser = bootData.user;
  var USER_COOKIE = "__edge_user";
  var isLocal = document.location.host.match(/microclimates.com/) == null;

  // Expose mcHub onto $ vs. window so linters don't complain about window
  var mcHub = $.mcHub = {
    id: bootData.settings.appSubUrl.substr(1),
    name: 'Edge Site',
    mcSite: document.location.host,
    inApp: document.location.search.indexOf('inApp=true') > 0,
    isLocal: isLocal,
    appSubUrl: bootData.settings.appSubUrl,
    user: void 0, 
    ROLE_GUEST: 0,
    ROLE_MONITOR: 1,
    ROLE_CONTROLLER: 2,
    ROLE_ADMIN: 3,
    ROLE_OWNER: 4,

    // Edit mode is raw Grafana without embellishments
    setEditMode: function(inEdit) {
      $('body').toggleClass('edge', !inEdit);
    },

    // Update the parent site menu
    updateSitemenu: function() {
      window.parent.postMessage('updateSitemenu','*');
    },

    // Toggle the parent nav menu (if being contained)
    toggleParentMenu: function(event) {
      // Don't toggle the nav menu if grafana is using the button
      var inEditMode = $('body.edge').length == 0;
      var dualPurposeTarget = event.currentTarget.tagName == 'A';
      if (!dualPurposeTarget || (dualPurposeTarget && !inEditMode)) {
        window.parent.postMessage('toggleNavMenu','*');
      }
    },

    // This adds the hub name and attaches header click events
    addHubName: function() {
      var container = $('.navbar__spacer');
      var isRendered = container.length > 0;
      if (isRendered) {
        container.html('<div class="hub-name"></div>');
        $('.hub-name').text(mcHub.name);

        // Attach parent window menu toggle
        $('.navbar-page-btn,.navbar__spacer')
          .off('click', mcHub.toggleParentMenu)
          .on('click', mcHub.toggleParentMenu)
          .css({cursor:'pointer'})
      }
      else {
        setTimeout(mcHub.addHubName, 100);
      }
    },

    // Listen for an MQTT topic
    // topic: Topic to listen for (with wildcards)
    // cb(topic, state) - callback
    //   topic: Actual topic being sent (no wildcard)
    //   msg: Message sent to that topic (state)
    onTopic: function(topic, cb) {
      var ioPath = mcHub.appSubUrl + '/hub/socket.io';
      var sock = io.connect('/databus?topic=' + encodeURIComponent(topic), {path:ioPath});
      var subFn = function(body) {
        cb(body.topic, body.message);
      };
      sock.on('message', subFn);
      ioListeners.push({sock:sock, topic:topic, cb:cb, subFn: subFn});
    },

    offTopic: function(topic, cb) {
      ioListeners.forEach(function(listener) {
        if (listener.topic == topic && (!cb || listener.cb === cb)) {
          listener.sock.off('message', listener.subFn);
          listener.sock.close();
          listener.subFn = null;
          listener.cb = null;
        }
      });
    },

    // Run this whenever a new page is navigated to
    onPageNav: function() {
      var href = document.location.href;
      mcHub.addHubName();

      // Switch edit mode on/off based on being in a same origin sub-iframe
      try {
        var isFramed = (window !== window.parent || window.origin !== window.parent.origin);
        mcHub.setEditMode(!isFramed);
      }
      catch(e) {
        mcHub.setEditMode(false);
      }

      // Remove all databus listeners
      // Listeners: [{sock:sock, topic:topic, cb:cb, subFn: subFn},...]
      ioListeners.forEach(function(listener) {
        listener.sock.off('message', listener.subFn);
        listener.sock.close();
        listener.subFn = null;
        listener.cb = null;
        listener.sock = null;
      })
      ioListeners = [];

      // Fade in the screen after DOM is rendered
      $('body').removeClass('edge-show');
      setTimeout(function() {
        $('body').addClass('edge-show');
      },100);

      // Set the page title whenever it's changed beneath us by Grafana
      if (!$.mcObserver) {
        $.mcObserver = new window.WebKitMutationObserver(function() {
          var pageName = $('.navbar-page-btn').text().trim();
          var pageTitle = (pageName ? pageName + ' - ' : '') + $.mcHub.name;
          if (document.title != pageTitle) {
            document.title = pageTitle;
          }
        });
        var target = document.querySelector('head > title');
        $.mcObserver.observe(target, { subtree: true, characterData: true, childList: true });
      }
    },

    // This is called to hide the time picker in controlled pages
    showTimePicker: function(show) {
      if (show) {
        $('.gf-timepicker-nav, .panel-menu-container.dropdown').show();
        $('.hub-name').css({textAlign:'center', paddingRight:0});
      }
      else {
        $('.gf-timepicker-nav, .panel-menu-container.dropdown').hide();
        $('.hub-name').css({textAlign:'right', paddingRight:10});
      }
    },
    cloudUrl: function(endpoint){
      var host = mcHub.isLocal ? document.location.origin : 'https://microclimates.com';
      return host + endpoint;
    },
    cloudApiUrl: function(endpoint){
      var path = mcHub.isLocal ? '/hub/proxyApi' : '/api';
      return mcHub.cloudUrl(path + endpoint);
    },
    cloudAccountUrl: function(endpoint){
      var path = mcHub.isLocal ? '/hub/proxyAccount' : '/account';
      return mcHub.cloudUrl(path + endpoint);
    },
    grafanaUrl: function(endpoint){
      var host = document.location.origin;
      return document.location.origin + mcHub.appSubUrl + endpoint;
    },
    hubApiUrl: function(endpoint){
      var host = document.location.origin;
      var hubId = mcHub.appSubUrl;
      return mcHub.grafanaUrl('/hub' + endpoint);
    },

    // Triggered after the DOM has rendered on the page for an angular component
    onFormRender: function($scope, fn) {
      $scope.$evalAsync(function() { 
        setTimeout(fn, 1);
      });
    }

  };

  // Get a root scope and listen for page navigation events
  mcHub.onPageNav();
  function setInjector() {
    try {
      if (!$.rootScope) {
        $.injector = angular.element(document.body).injector();
        $.rootScope = $.injector.get('$rootScope');
        var $location = $.injector.get('$location');

        // Turn off page saving if page served inApp
        if (mcHub.inApp) {
          $.injector.get('contextSrv').isEditor = false;
        }

        // Watch page changes, and re-attach navigation
        $.rootScope.$on('$locationChangeSuccess', function(event, newUrl, oldUrl) {
          setTimeout(function() {
            mcHub.onPageNav();
          }, 10);
        });
      }
    } catch (e) {}
  }

  // Assure page is connected - these are idempotent
  setTimeout(setInjector, 500);
  setTimeout(setInjector, 1000);
  setTimeout(setInjector, 5000);
  setTimeout(setInjector, 10000);
  setTimeout(setInjector, 30000);

  // Hot keys
  window.addEventListener("keypress", function(event) {
    // Ctrl-E: Toggle quick dashboard edit if administrator
    if (event.charCode == 5 && mcHub.user && mcHub.user.role >= mcHub.ROLE_ADMIN) {
      mcHub.setEditMode($('body.edge').length >= 1);
    }
  }, false);

  // Listen for container based navigation
  window.addEventListener("message", function(event) {
    var data = event.data;
    if (typeof data == 'string' && data.substr(0,1) == '{') {
      data = JSON.parse(data);
    }
    if (data.navigateTo && $.injector && $.rootScope) {
      var url = data.navigateTo;
      var $location = $.injector.get('$location');
      var backendSrv = $.injector.get('backendSrv');

      // Translate old urls to new urls if necessary
      // Old urls: /{hubid}/dashboard/db/{slug}?orgId=1&inApp=true
      // New urls: /{hubid}/d/{uuid}/{slug}?orgId=1&inApp=true
      if (url.indexOf('/dashboard/db/') == 0) {
        var urlParts = url.split('?')[0].split('/')
        var slug = urlParts[urlParts.length - 1];
        backendSrv.getDashboardBySlug(slug)
          .then(function(rsp) {
            var newUrl = url;
            if (rsp) {
              newUrl = '/d/' + rsp.dashboard.uid + '/' + slug + '?' + url.split('?')[1];
            }
            setTimeout(function() {
              $location.url(newUrl);
              $.rootScope.$apply();
            },1);
          })
      }
      else {
        $location.url(url);
        $.rootScope.$apply();
      }

    }
  }, false);

  // Process the user cookie
  if (document.cookie.indexOf(USER_COOKIE) >= 0) {
    document.cookie.split('; ').forEach(function(cookie) {
      if (cookie.indexOf(USER_COOKIE) === 0) {
        // See mc-account/lib/account.js for the format of this cookie
        var userCookie = cookie.split('=')[1]
        var userCookieParts = userCookie.split('|')
        var hubParts = userCookieParts[1]
        var hubs = []
        if (hubParts) {
          hubParts = hubParts.split(',')
          hubParts.forEach(function(hubPart) {
            var idName = hubPart.split('+');
            var id = decodeURIComponent(idName[0]);
            var name = decodeURIComponent(idName[1]);
            hubs.push({
              id: id,
              name: name,
              health: +idName[2],
              role: +idName[3],
            })
          })
        }
        mcHub.user = {
          firstName: decodeURIComponent(userCookieParts[0]),
          hubs: hubs
        }

        // Determine this hub name based on the URL
        var hubId = document.location.pathname.split('/')[1];
        var thisHub = _.find(hubs, function(hub) {
          return hub.id == hubId;
        })

        // Set this hub info from the cookie
        mcHub.id = thisHub.id;
        mcHub.name = thisHub.name || mcHub.id;
        mcHub.health = thisHub.health;
        mcHub.user.role = thisHub.role;
      }
    })
  }

})
