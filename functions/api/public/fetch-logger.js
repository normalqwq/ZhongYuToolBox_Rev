(function () {
  var panel = null, list = null, count = 0;

  function ensure() {
    if (panel) return;
    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;' +
      'background:rgba(0,0,0,.88);color:#fff;font:12px/1.5 monospace;' +
      'z-index:2147483647;padding:8px;white-space:pre-wrap;word-break:break-all';
    panel.innerHTML =
      '<div style="color:#4ade80;font-weight:bold;margin-bottom:6px">' +
      '请求监控（查完记得删掉这个文件）</div>';
    list = document.createElement('div');
    panel.appendChild(list);
    document.body.appendChild(panel);
  }

  function add(url, method) {
    count++;
    ensure();
    var isLocal = false;
    try { isLocal = new URL(url, location.href).origin === location.origin; } catch (e) {}
    var color = isLocal ? '#4ade80' : '#f87171';
    var row = document.createElement('div');
    row.style.cssText = 'border-top:1px solid #333;padding:4px 0';
    row.innerHTML =
      '<span style="color:#94a3b8">#' + count + ' ' + (method || '') + '</span> ' +
      '<span style="color:' + color + '">' + (isLocal ? '[同源]' : '[外部]') + '</span> ' + url;
    list.insertBefore(row, list.firstChild);
  }

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var u = typeof input === 'string' ? input : (input && input.url);
      var m = (init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET';
      if (u) add(u, m);
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { add(url, method); } catch (e) {}
    return origOpen.apply(this, arguments);
  };
})();
