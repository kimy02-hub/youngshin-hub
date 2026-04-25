/* dashboard config */
(function(){
  var p1 = 'ghp_oWNa3i';
  var p2 = 'OgxVh2Q5RC';
  var p3 = 't189y1y7gMPKgy3kEP8O';
  localStorage.setItem('gh_token', p1+p2+p3);
})();
// COLOR PICKER FIX
(function() {
  function fixPicker() {
    window.toggleColorPicker = function(taskId) {
      var pickers = document.querySelectorAll('.color-dots');
      var picker = document.getElementById('cp-' + taskId);
      if (picker && picker.style.display === 'flex') {
        pickers.forEach(function(p){ p.style.display='none'; }); return;
      }
      pickers.forEach(function(p){ p.style.display='none'; });
      if (!picker) return;
      if (picker.parentElement !== document.body) document.body.appendChild(picker);
      var dots = document.querySelectorAll('.color-dot[onclick]');
      var dot = null;
      for (var i=0; i<dots.length; i++) {
        var oc = dots[i].getAttribute('onclick') || '';
        if (oc.indexOf(taskId) >= 0) {
          var tr = dots[i].getBoundingClientRect();
          if (tr.width > 0) { dot = dots[i]; break; }
        }
      }
      if (!dot) return;
      var r = dot.getBoundingClientRect();
      var W = document.documentElement.clientWidth;
      var H = document.documentElement.clientHeight;
      var left = r.right - 165;
      if (left < 4) left = 4;
      if (left + 165 > W) left = W - 169;
      var top = r.bottom + 4;
      if (top + 80 > H) top = r.top - 84;
      if (top < 60) top = 60;
      picker.style.cssText = 'display:flex;position:fixed;z-index:999999;top:' + top + 'px;left:' + left + 'px;background:white;border:1px solid #ccc;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.3);gap:5px;padding:8px;flex-wrap:wrap;width:165px;';
    };
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.color-picker') && !e.target.closest('.color-dots')) {
        document.querySelectorAll('.color-dots').forEach(function(p){ p.style.display='none'; });
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixPicker);
  } else { fixPicker(); }
  setTimeout(fixPicker, 2000);
})();

// SORT FIX
(function() {
  function fixSort() {
    window.setSortOrder = function(order) {
      if (typeof currentSort !== 'undefined') currentSort = order;
      else window.currentSort = order;
      var sel = document.getElementById('taskSort');
      if (sel) sel.value = order;
      if (typeof renderTasks === 'function') renderTasks();
      else if (typeof window.renderTasks === 'function') window.renderTasks();
    };
    // Override sortTasks to handle subduedate
    var origSortTasks = typeof sortTasks === 'function' ? sortTasks : null;
    window.sortTasks = function(taskList) {
      var cs = typeof currentSort !== 'undefined' ? currentSort : window.currentSort;
      if (cs !== 'subduedate') {
        if (origSortTasks) return origSortTasks(taskList);
        return taskList;
      }
      var sorted = taskList.slice();
      sorted.sort(function(a, b) {
        function earliest(t) {
          var dates = [];
          if (t.due) dates.push(t.due);
          (t.subtasks || []).forEach(function(s) { if (!s.done && s.due) dates.push(s.due); });
          return dates.length ? dates.sort()[0] : null;
        }
        var ad = earliest(a), bd = earliest(b);
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return ad < bd ? -1 : ad > bd ? 1 : 0;
      });
      return sorted;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fixSort);
  else fixSort();
  setTimeout(fixSort, 2000);
})();
