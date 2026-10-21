/* COS 엔트리 연습 채점기
   - 시작(풀이) 파일과 정답 파일을 비교해 "고쳐야 하는 블록"을 찾고,
     학생 답안이 그 블록들을 정답과 같게 고쳤는지 확인합니다.
   - 블록의 종류·순서·입력값을 비교하며, 블록 위치·ID는 무시합니다.
   - 공식 시험 채점이 아닌 연습용입니다. 동작이 같은 다른 풀이는 인정하지 않습니다. */
(function(root){
  var TD = (typeof TextDecoder !== 'undefined') ? new TextDecoder() : null;

  var LABELS = {
    when_run_button_click:'시작하기 버튼 클릭 시', when_some_key_pressed:'키를 눌렀을 때',
    when_object_click:'오브젝트를 클릭했을 때', when_object_click_canceled:'오브젝트 클릭 해제 시',
    mouse_clicked:'마우스를 클릭했을 때', mouse_click_cancled:'마우스 클릭 해제 시',
    when_message_cast:'신호를 받았을 때', when_scene_start:'장면이 시작되었을 때', when_clone_start:'복제본이 처음 생성되었을 때',
    move_direction:'이동하기', move_x:'x 좌표 바꾸기', move_y:'y 좌표 바꾸기',
    locate_xy:'좌표로 이동', locate_x:'x 좌표로 이동', locate_y:'y 좌표로 이동', locate_xy_time:'시간 동안 좌표로 이동',
    locate_object_time:'시간 동안 위치 이동', locate:'위치로 이동', move_to_angle:'방향으로 이동',
    rotate_relative:'방향 회전', rotate_absolute:'각도 정하기', direction_relative:'이동 방향 회전', direction_absolute:'이동 방향 정하기',
    set_scale_size:'크기 정하기', change_scale_size:'크기 바꾸기', flip_x:'상하 모양 뒤집기', flip_y:'좌우 모양 뒤집기',
    show:'모양 보이기', hide:'모양 숨기기', dialog_time:'말하기(초)', dialog:'말하기', remove_dialog:'말하기 지우기',
    change_to_some_shape:'모양 바꾸기', change_to_next_shape:'다음 모양으로 바꾸기',
    add_effect_amount:'효과 주기', change_effect_amount:'효과 바꾸기', erase_all_effects:'효과 지우기',
    wait_second:'기다리기', repeat_basic:'반복하기(횟수)', repeat_inf:'계속 반복하기', repeat_while_true:'조건 반복하기',
    stop_repeat:'반복 중단', _if:'만일 ~라면', if_else:'만일 ~라면 아니면', wait_until_true:'참이 될 때까지 기다리기',
    stop_object:'멈추기', restart_project:'처음부터 다시 실행', message_cast:'신호 보내기', message_cast_wait:'신호 보내고 기다리기',
    create_clone:'복제본 만들기', delete_clone:'복제본 삭제', remove_all_clones:'모든 복제본 삭제',
    set_variable:'변수 정하기', change_variable:'변수 값 바꾸기', show_variable:'변수 보이기', hide_variable:'변수 숨기기',
    sound_something_with_block:'소리 재생', sound_something_wait_with_block:'소리 재생 후 기다리기', sound_volume_set:'소리 크기 정하기',
    set_visible_answer:'대답 숨기기/보이기', ask_and_wait:'묻고 대답 기다리기'
  };

  /* project → { 블록키: {object, type, value} } */
  function normalize(project){
    project = project || {};
    var refs = {};
    ['objects','variables','messages','scenes'].forEach(function(k){
      (project[k] || []).forEach(function(o){ refs[o.id] = k + ':' + o.name; });
    });
    (project.objects || []).forEach(function(o){
      ((o.sprite && o.sprite.pictures) || []).forEach(function(p){ refs[p.id] = 'picture:' + p.name; });
      ((o.sprite && o.sprite.sounds) || []).forEach(function(p){ refs[p.id] = 'sound:' + p.name; });
    });
    function val(x){
      if(Array.isArray(x)) return x.map(val);
      if(x && typeof x === 'object'){
        if(x.type) return {type: refs[x.type] || x.type, params: params(x.params)};
        return x;
      }
      if(typeof x === 'string'){
        if(refs[x]) return refs[x];
        if(x.trim() !== '' && isFinite(Number(x))) return Number(x);
      }
      return x;
    }
    function params(a){
      var p = (a || []).map(val);
      while(p.length && p[p.length-1] === null) p.pop();
      return p;
    }
    var out = {};
    var functions = (project.functions || []).map(function(f, i){
      var code = typeof f.content === 'string' ? JSON.parse(f.content) : (f.content || []);
      var name = (code[0] && code[0][0] && code[0][0].params && code[0][0].params[0] && code[0][0].params[0].params && code[0][0].params[0].params[0]) || ('함수 ' + (i+1));
      refs['func_' + f.id] = 'function:' + name;
      return {name: '함수 · ' + name, script: code};
    });
    (project.objects || []).concat(functions).forEach(function(o){
      var code = typeof o.script === 'string' ? JSON.parse(o.script) : (o.script || []);
      var groups = {};
      code.forEach(function(thread){
        if(!thread || !thread.length) return;
        var ev = JSON.stringify(val(thread[0]));
        (groups[ev] = groups[ev] || []).push(thread);
      });
      Object.keys(groups).sort().forEach(function(ev){
        var threads = groups[ev].sort(function(a, b){
          return JSON.stringify(a.map(val)).localeCompare(JSON.stringify(b.map(val)));
        });
        threads.forEach(function(thread, ti){
          (function walk(list, path){
            list.forEach(function(b, i){
              var key = o.name + ' / ' + ev + ' / ' + ti + path + '/' + i;
              out[key] = {object: o.name, type: b.type, value: JSON.stringify(val(b))};
              (b.statements || []).forEach(function(s, j){ walk(s, path + '/' + i + ':' + j); });
            });
          })(thread, '');
        });
      });
    });
    return out;
  }

  /* 시작·정답·학생 project를 비교해 점수와 항목별 결과를 만듭니다 */
  function grade(starter, answer, student){
    var a = normalize(answer), b = normalize(starter), s = normalize(student);
    var targets = Object.keys(a).filter(function(k){ return !b[k] || a[k].value !== b[k].value; });
    var deleted = Object.keys(b).filter(function(k){ return !a[k]; });
    var checks = targets.map(function(k){
      return {label: a[k].object + ' · ' + (LABELS[a[k].type] || '블록 수정'), ok: !!s[k] && s[k].value === a[k].value};
    });
    deleted.forEach(function(k){ checks.push({label: b[k].object + ' · 불필요한 블록 제거', ok: !s[k]}); });
    // 오브젝트(배경 포함) 가져오기·삭제 문제: 시작 파일과 정답 파일의 오브젝트 구성이 다르면 항목으로 확인
    var onames = function(p){ return (p.objects || []).map(function(o){ return o.name; }); };
    var oa = onames(answer), ob = onames(starter), os = onames(student);
    oa.filter(function(n){ return ob.indexOf(n) < 0; }).forEach(function(n){ checks.push({label: "오브젝트 '" + n + "' 가져오기", ok: os.indexOf(n) >= 0}); });
    ob.filter(function(n){ return oa.indexOf(n) < 0; }).forEach(function(n){ checks.push({label: "오브젝트 '" + n + "' 삭제", ok: os.indexOf(n) < 0}); });
    // 시작 파일에도 정답에도 없는 블록이 학생 답안에 있으면(불필요하게 추가한 블록) 별도 항목으로 감점
    var extra = Object.keys(s).filter(function(k){ return !a[k] && !b[k]; });
    if(extra.length) checks.push({label: '정답 구조에 없는 추가 블록 ' + extra.length + '개', ok: false});
    if(!checks.length) checks.push({label: '전체 블록 구조', ok: JSON.stringify(s) === JSON.stringify(a)});
    var correct = checks.filter(function(c){ return c.ok; }).length;
    return {score: Math.round(correct / checks.length * 100), correct: correct, total: checks.length, checks: checks};
  }

  /* ENT(tar.gz) 바이트에서 project.json만 꺼내기 (fflate 필요) */
  function readProject(buf){
    var tar = root.fflate.gunzipSync(new Uint8Array(buf)), off = 0;
    while(off + 512 <= tar.length){
      var h = tar.subarray(off, off + 512), zero = true;
      for(var i = 0; i < 512; i++){ if(h[i] !== 0){ zero = false; break; } }
      if(zero) break;
      var str = function(a, z){ var t = TD.decode(h.subarray(a, z)); var n = t.indexOf('\0'); return n >= 0 ? t.slice(0, n) : t; };
      var name = str(0, 100), size = parseInt(str(124, 136).trim() || '0', 8);
      off += 512;
      if(/(^|\/)project\.json$/.test(name)) return JSON.parse(TD.decode(tar.subarray(off, off + size)));
      off += Math.ceil(size / 512) * 512;
    }
    throw new Error('ENT 안에 project.json이 없어요.');
  }

  root.CosGrader = {normalize: normalize, grade: grade, readProject: readProject, LABELS: LABELS};
  if(typeof module !== 'undefined') module.exports = root.CosGrader;
})(typeof window !== 'undefined' ? window : globalThis);
