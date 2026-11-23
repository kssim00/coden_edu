/* COS 스크래치 연습 채점기
   - 시작(풀이) 파일과 정답 파일을 비교해 "고쳐야 하는 블록"을 찾고,
     학생 답안이 그 블록들을 정답과 같게 고쳤는지 확인합니다.
   - 블록의 종류·순서·입력값을 비교하며, 블록 위치·ID는 무시합니다.
   - 공식 시험 채점이 아닌 연습용입니다. 동작이 같은 다른 풀이는 인정하지 않습니다.
   - 입력은 sb3(zip) 바이트에서 꺼낸 project.json 입니다. */
(function(root){
  var TD = (typeof TextDecoder !== 'undefined') ? new TextDecoder() : null;

  var LABELS = {
    motion_movesteps:'움직이기', motion_turnright:'오른쪽으로 회전', motion_turnleft:'왼쪽으로 회전',
    motion_goto:'위치로 이동', motion_gotoxy:'x:y: 위치로 이동', motion_glideto:'위치로 이동(초)', motion_glidesecstoxy:'x:y: 위치로 이동(초)',
    motion_pointindirection:'방향 보기', motion_pointtowards:'쪽 보기', motion_changexby:'x 좌표 바꾸기', motion_setx:'x 좌표 정하기',
    motion_changeyby:'y 좌표 바꾸기', motion_sety:'y 좌표 정하기', motion_ifonedgebounce:'벽에 닿으면 튕기기', motion_setrotationstyle:'회전 방식 정하기',
    motion_xposition:'x 좌표', motion_yposition:'y 좌표', motion_direction:'방향',
    looks_sayforsecs:'말하기(초)', looks_say:'말하기', looks_thinkforsecs:'생각하기(초)', looks_think:'생각하기',
    looks_switchcostumeto:'모양 바꾸기', looks_nextcostume:'다음 모양', looks_switchbackdropto:'배경 바꾸기', looks_nextbackdrop:'다음 배경',
    looks_changesizeby:'크기 바꾸기', looks_setsizeto:'크기 정하기', looks_changeeffectby:'효과 바꾸기', looks_seteffectto:'효과 정하기',
    looks_cleargraphiceffects:'효과 지우기', looks_show:'보이기', looks_hide:'숨기기', looks_gotofrontback:'맨 앞/뒤로 보내기',
    looks_goforwardbackwardlayers:'레이어 이동', looks_costumenumbername:'모양 번호/이름', looks_size:'크기',
    sound_playuntildone:'소리 재생(끝까지)', sound_play:'소리 재생', sound_stopallsounds:'모든 소리 끄기',
    sound_changevolumeby:'음량 바꾸기', sound_setvolumeto:'음량 정하기',
    event_whenflagclicked:'깃발을 클릭했을 때', event_whenkeypressed:'키를 눌렀을 때', event_whenthisspriteclicked:'스프라이트를 클릭했을 때',
    event_whenbackdropswitchesto:'배경이 바뀌었을 때', event_whengreaterthan:'~보다 클 때', event_whenbroadcastreceived:'메시지를 받았을 때',
    event_broadcast:'메시지 보내기', event_broadcastandwait:'메시지 보내고 기다리기',
    control_wait:'기다리기', control_repeat:'반복하기', control_forever:'무한 반복하기', control_if:'만약 ~라면', control_if_else:'만약 ~라면 아니면',
    control_wait_until:'~까지 기다리기', control_repeat_until:'~까지 반복하기', control_stop:'멈추기', control_start_as_clone:'복제되었을 때',
    control_create_clone_of:'복제하기', control_delete_this_clone:'이 복제본 삭제하기',
    sensing_touchingobject:'~에 닿았는가?', sensing_touchingcolor:'색에 닿았는가?', sensing_distanceto:'~까지의 거리', sensing_askandwait:'묻고 기다리기',
    sensing_answer:'대답', sensing_keypressed:'키를 눌렀는가?', sensing_mousedown:'마우스를 클릭했는가?', sensing_mousex:'마우스 x', sensing_mousey:'마우스 y',
    sensing_timer:'타이머', sensing_resettimer:'타이머 초기화', sensing_of:'~의 ~', sensing_setdragmode:'드래그 모드 정하기',
    operator_add:'+', operator_subtract:'-', operator_multiply:'×', operator_divide:'÷', operator_random:'난수', operator_gt:'>', operator_lt:'<', operator_equals:'=',
    operator_and:'그리고', operator_or:'또는', operator_not:'아니다', operator_join:'결합하기', operator_letter_of:'글자', operator_length:'길이',
    operator_mod:'나머지', operator_round:'반올림', operator_mathop:'수학 연산', operator_contains:'포함하는가?',
    data_setvariableto:'변수 정하기', data_changevariableby:'변수 바꾸기', data_showvariable:'변수 보이기', data_hidevariable:'변수 숨기기',
    data_variable:'변수', data_addtolist:'리스트에 추가', data_deleteoflist:'리스트에서 삭제', data_deletealloflist:'리스트 모두 삭제',
    data_insertatlist:'리스트에 삽입', data_replaceitemoflist:'리스트 항목 바꾸기', data_itemoflist:'리스트 항목', data_lengthoflist:'리스트 길이',
    data_listcontainsitem:'리스트 포함 여부', data_itemnumoflist:'리스트 항목 번호', data_showlist:'리스트 보이기', data_hidelist:'리스트 숨기기',
    procedures_definition:'블록 정의', procedures_call:'내 블록 사용', argument_reporter_string_number:'블록 입력값', argument_reporter_boolean:'블록 입력값'
  };
  var SUBSTACKS = ['SUBSTACK', 'SUBSTACK2'];

  function num(v){
    if(typeof v === 'number') return String(v);
    if(typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return String(Number(v));
    return v;
  }

  /* project.json 하나를 "스프라이트별 스크립트" 구조로 풀어 냅니다 → { 블록키: {object, type, value} } */
  /* '보기블록' 스프라이트: 힌트용 블록 보관함. 실제 시험처럼 가져다 쓰거나 복제·이동·삭제해도 채점하지 않습니다 */
  function isHint(t){ return !t.isStage && /보기|힌트/.test(t.name || ''); }

  function normalize(project){
    project = project || {};
    var out = {};
    (project.targets || []).forEach(function(t){
      if(isHint(t)) return;
      var blocks = t.blocks || {};
      var objName = t.isStage ? '배경(Stage)' : t.name;

      function prim(a){                        // [type, value, id?] 형태의 입력 값
        if(!Array.isArray(a)) return a;
        return a[0] + ':' + (a[0] >= 11 ? a[1] : num(a[1]));   // 변수·리스트·메시지는 ID 대신 이름만 비교
      }
      function inp(i){                          // 입력 하나(값 또는 블록)
        if(!i) return null;
        var v = i[1];
        if(typeof v === 'string' && blocks[v] && !Array.isArray(blocks[v])) return '(' + expr(blocks[v]) + ')';
        if(Array.isArray(v)) return prim(v);
        return v == null ? null : String(v);
      }
      function mut(b){
        var m = b.mutation; if(!m) return '';
        var o = {};
        Object.keys(m).sort().forEach(function(k){
          if(k === 'argumentids' || k === 'children' || k === 'tagName') return;   // 임의 ID는 무시
          if(b.opcode === 'procedures_call' && k !== 'proccode') return;          // 내 블록 사용: 이름(모양)만 비교 (warp 등은 편집기마다 형식이 달라요)
          o[k] = (k === 'warp') ? String(m[k]) : m[k];
        });
        return JSON.stringify(o);
      }
      function expr(b){                         // 이 블록 자체 + 안쪽 입력 블록(하위 스택·다음 블록 제외)
        if(Array.isArray(b)) return prim(b);
        var f = Object.keys(b.fields || {}).sort().map(function(k){
          var x = b.fields[k]; return k + '=' + num(x && x[0]);
        });
        var ins;
        var inputs = b.inputs || {};
        if((b.opcode === 'procedures_call' || b.opcode === 'procedures_prototype') && b.mutation){
          var ids = []; try{ ids = JSON.parse(b.mutation.argumentids || '[]'); }catch(e){}
          ins = ids.map(function(id, n){ return n + '=' + inp(inputs[id]); });
        } else {
          ins = Object.keys(inputs).filter(function(k){ return SUBSTACKS.indexOf(k) < 0; }).sort().map(function(k){
            return k + '=' + inp(inputs[k]);
          });
        }
        return b.opcode + '[' + f.join(',') + '|' + ins.join(',') + ']' + mut(b);
      }
      function chain(id){                       // 첫 블록 id부터 next를 따라 한 줄 스택으로
        var list = [], guard = 0;
        while(id && blocks[id] && !Array.isArray(blocks[id]) && guard++ < 5000){ list.push(blocks[id]); id = blocks[id].next; }
        return list;
      }

      var tops = [];
      Object.keys(blocks).forEach(function(id){
        var b = blocks[id];
        if(Array.isArray(b)){ tops.push({list: [b]}); return; }            // 바깥에 놓인 변수 블록
        if(b.topLevel && !b.shadow) tops.push({list: chain(id)});
      });
      var groups = {};
      tops.forEach(function(s){
        if(!s.list.length) return;
        var ev = expr(s.list[0]);
        (groups[ev] = groups[ev] || []).push(s.list);
      });
      Object.keys(groups).sort().forEach(function(ev){
        var threads = groups[ev].sort(function(a, b){
          var x = JSON.stringify(a.map(function(q){ return expr(q) + subs(q); })), y = JSON.stringify(b.map(function(q){ return expr(q) + subs(q); }));
          return x < y ? -1 : (x > y ? 1 : 0);
        });
        threads.forEach(function(thread, ti){
          (function walk(list, path){
            list.forEach(function(b, i){
              var key = objName + ' / ' + ev + ' / ' + ti + path + '/' + i;
              out[key] = {object: objName, type: Array.isArray(b) ? 'data_variable' : b.opcode, value: expr(b)};
              if(Array.isArray(b)) return;
              SUBSTACKS.forEach(function(sk, j){
                var s = (b.inputs || {})[sk];
                if(s && typeof s[1] === 'string') walk(chain(s[1]), path + '/' + i + ':' + j);
              });
            });
          })(thread, '');
        });
      });
      function subs(b){                         // 정렬용: 하위 스택까지 포함한 문자열
        if(Array.isArray(b)) return '';
        return SUBSTACKS.map(function(sk){
          var s = (b.inputs || {})[sk];
          return s && typeof s[1] === 'string' ? '{' + chain(s[1]).map(function(q){ return expr(q) + subs(q); }).join(';') + '}' : '';
        }).join('');
      }
    });
    return out;
  }

  function names(project, pick){
    var r = [];
    (project.targets || []).forEach(function(t){ r = r.concat(pick(t)); });
    return r;
  }
  var spriteNamesS3 = function(p){ return names(p, function(t){ return (t.isStage || isHint(t)) ? [] : [t.name]; }); };
  var varNamesS3 = function(p){ return names(p, function(t){
    return Object.keys(t.variables || {}).map(function(k){ return (t.isStage ? '배경' : t.name) + ' / ' + t.variables[k][0]; });
  }); };
  var listNamesS3 = function(p){ return names(p, function(t){
    return Object.keys(t.lists || {}).map(function(k){ return (t.isStage ? '배경' : t.name) + ' / ' + t.lists[k][0]; });
  }); };


  /* ---------- 스크래치 2.0(sb2) project.json 지원 ----------
     sb2 블록은 [명령, 입력...] 배열입니다. sb3와 같은 방식(스프라이트 / 시작 블록 / 스레드 / 위치)으로 열쇠를 만들어
     시작·정답·학생 파일을 모두 sb2로 비교합니다. */
  var LABELS2 = {
    'forward:':'움직이기','turnRight:':'오른쪽으로 회전','turnLeft:':'왼쪽으로 회전','gotoSpriteOrMouse:':'위치로 이동','gotoX:y:':'x:y: 위치로 이동',
    'glideSecs:toX:y:elapsed:from:':'x:y: 위치로 이동(초)','heading:':'방향 보기','pointTowards:':'쪽 보기','changeXposBy:':'x 좌표 바꾸기','xpos:':'x 좌표 정하기',
    'changeYposBy:':'y 좌표 바꾸기','ypos:':'y 좌표 정하기','bounceOffEdge':'벽에 닿으면 튕기기','setRotationStyle':'회전 방식 정하기',
    'xpos':'x 좌표','ypos':'y 좌표','heading':'방향',
    'say:duration:elapsed:from:':'말하기(초)','say:':'말하기','think:duration:elapsed:from:':'생각하기(초)','think:':'생각하기',
    'lookLike:':'모양 바꾸기','nextCostume':'다음 모양','startScene':'배경 바꾸기','nextScene':'다음 배경','changeSizeBy:':'크기 바꾸기','setSizeTo:':'크기 정하기',
    'changeGraphicEffect:by:':'효과 바꾸기','setGraphicEffect:to:':'효과 정하기','filterReset':'효과 지우기','show':'보이기','hide':'숨기기',
    'comeToFront':'맨 앞으로 보내기','goBackByLayers:':'레이어 이동','costumeIndex':'모양 번호','scale':'크기',
    'playSound:':'소리 재생','doPlaySoundAndWait':'소리 재생(끝까지)','stopAllSounds':'모든 소리 끄기','changeVolumeBy:':'음량 바꾸기','setVolumeTo:':'음량 정하기',
    'whenGreenFlag':'깃발을 클릭했을 때','whenKeyPressed':'키를 눌렀을 때','whenClicked':'스프라이트를 클릭했을 때','whenSceneStarts':'배경이 바뀌었을 때',
    'whenSensorGreaterThan':'~보다 클 때','whenIReceive':'메시지를 받았을 때','broadcast:':'메시지 보내기','doBroadcastAndWait':'메시지 보내고 기다리기',
    'wait:elapsed:from:':'기다리기','doRepeat':'반복하기','doForever':'무한 반복하기','doIf':'만약 ~라면','doIfElse':'만약 ~라면 아니면',
    'doWaitUntil':'~까지 기다리기','doUntil':'~까지 반복하기','stopScripts':'멈추기','whenCloned':'복제되었을 때','createCloneOf':'복제하기','deleteClone':'이 복제본 삭제하기',
    'touching:':'~에 닿았는가?','touchingColor:':'색에 닿았는가?','color:sees:':'색이 색에 닿았는가?','distanceTo:':'~까지의 거리','doAsk':'묻고 기다리기','answer':'대답',
    'keyPressed:':'키를 눌렀는가?','mousePressed':'마우스를 클릭했는가?','mouseX':'마우스 x','mouseY':'마우스 y','timer':'타이머','timerReset':'타이머 초기화',
    'getAttribute:of:':'~의 ~','+':'+','-':'-','*':'×','/':'÷','randomFrom:to:':'난수','>':'>','<':'<','=':'=','&':'그리고','|':'또는','not':'아니다',
    'concatenate:with:':'결합하기','letter:of:':'글자','stringLength:':'길이','%':'나머지','rounded':'반올림','computeFunction:of:':'수학 연산',
    'setVar:to:':'변수 정하기','changeVar:by:':'변수 바꾸기','showVariable:':'변수 보이기','hideVariable:':'변수 숨기기','readVariable':'변수',
    'append:toList:':'리스트에 추가','deleteLine:ofList:':'리스트에서 삭제','insert:at:ofList:':'리스트에 삽입','setLine:ofList:to:':'리스트 항목 바꾸기',
    'getLine:ofList:':'리스트 항목','lineCountOfList:':'리스트 길이','list:contains:':'리스트 포함 여부','showList:':'리스트 보이기','hideList:':'리스트 숨기기','contentsOfList:':'리스트',
    'procDef':'블록 정의','call':'내 블록 사용','getParam':'블록 입력값',
    'clearPenTrails':'지우기','stampCostume':'도장 찍기','putPenDown':'펜 내리기','putPenUp':'펜 올리기','penColor:':'펜 색 정하기',
    'changePenHueBy:':'펜 색 바꾸기','setPenHueTo:':'펜 색 정하기','changePenShadeBy:':'펜 명암 바꾸기','setPenShadeTo:':'펜 명암 정하기','changePenSizeBy:':'펜 굵기 바꾸기','penSize:':'펜 굵기 정하기'
  };
  var C_SLOTS = {doIf:[2], doIfElse:[2,3], doRepeat:[2], doForever:[1], doUntil:[2], doForeverIf:[2], doWhile:[2]};
  function isSb2(p){ return !!p && !p.targets && (Array.isArray(p.children) || p.objName !== undefined); }
  function sb2Objects(p){
    var list = [{o: p, stage: true}];
    (p.children || []).forEach(function(c){ if(c && c.objName !== undefined && !c.listName && !c.cmd) list.push({o: c, stage: false}); });
    return list;
  }
  function isStackArr(v){ return Array.isArray(v) && (v.length === 0 || Array.isArray(v[0])); }
  function isBlockArr(v){ return Array.isArray(v) && typeof v[0] === 'string'; }
  function subSlots(b){
    var fixed = C_SLOTS[b[0]], r = [];
    for(var i = 1; i < b.length; i++){ if((fixed && fixed.indexOf(i) >= 0) || isStackArr(b[i])) r.push(i); }
    return r;
  }
  function expr2(b){
    if(!isBlockArr(b)) return String(num(b));
    if(b[0] === 'procDef') return 'procDef[' + b[1] + ']';
    var slots = subSlots(b), parts = [];
    for(var i = 1; i < b.length; i++){
      if(slots.indexOf(i) >= 0) continue;
      var v = b[i];
      parts.push(isBlockArr(v) ? '(' + expr2(v) + ')' : (v == null ? 'null' : (Array.isArray(v) ? JSON.stringify(v) : String(num(v)))));
    }
    return b[0] + '[' + parts.join(',') + ']';
  }
  function subs2(b){
    if(!isBlockArr(b)) return '';
    return subSlots(b).map(function(i){ var s = b[i]; return '{' + (Array.isArray(s) ? s.map(function(q){ return expr2(q) + subs2(q); }).join(';') : '') + '}'; }).join('');
  }
  function normalize2(project){
    var out = {};
    sb2Objects(project).forEach(function(x){
      var t = x.o;
      if(!x.stage && /보기|힌트/.test(t.objName || '')) return;
      var objName = x.stage ? '배경(Stage)' : t.objName, groups = {};
      (t.scripts || []).forEach(function(sc){
        var list = Array.isArray(sc) ? sc[2] : null;
        if(!Array.isArray(list) || !list.length) return;
        var ev = expr2(list[0]);
        (groups[ev] = groups[ev] || []).push(list);
      });
      Object.keys(groups).sort().forEach(function(ev){
        var threads = groups[ev].sort(function(a, b){
          var x1 = JSON.stringify(a.map(function(q){ return expr2(q) + subs2(q); })), y1 = JSON.stringify(b.map(function(q){ return expr2(q) + subs2(q); }));
          return x1 < y1 ? -1 : (x1 > y1 ? 1 : 0);
        });
        threads.forEach(function(thread, ti){
          (function walk(list, path){
            list.forEach(function(b, i){
              var key = objName + ' / ' + ev + ' / ' + ti + path + '/' + i;
              out[key] = {object: objName, type: isBlockArr(b) ? b[0] : 'value', value: expr2(b)};
              if(!isBlockArr(b)) return;
              subSlots(b).forEach(function(si, j){ if(Array.isArray(b[si])) walk(b[si], path + '/' + i + ':' + j); });
            });
          })(thread, '');
        });
      });
    });
    return out;
  }
  var spriteNames2 = function(p){ return sb2Objects(p).filter(function(x){ return !x.stage && !/보기|힌트/.test(x.o.objName || ''); }).map(function(x){ return x.o.objName; }); };
  var varNames2 = function(p){ var r = []; sb2Objects(p).forEach(function(x){ (x.o.variables || []).forEach(function(v){ r.push((x.stage ? '배경' : x.o.objName) + ' / ' + v.name); }); }); return r; };
  var listNames2 = function(p){ var r = []; sb2Objects(p).forEach(function(x){ (x.o.lists || []).forEach(function(v){ r.push((x.stage ? '배경' : x.o.objName) + ' / ' + v.listName); }); }); return r; };

  /* 시작·정답·학생 project를 비교해 점수와 항목별 결과를 만듭니다 */
  function grade(starter, answer, student){
    var sb2 = isSb2(answer);
    var N = sb2 ? normalize2 : normalize, L = sb2 ? LABELS2 : LABELS;
    var spriteNames = sb2 ? spriteNames2 : spriteNamesS3, varNames = sb2 ? varNames2 : varNamesS3, listNames = sb2 ? listNames2 : listNamesS3;
    if(sb2 !== isSb2(student)) throw new Error(sb2 ? '스크래치 2.0(sb2) 답안이 아니에요.' : '스크래치 3.0(sb3) 답안이 아니에요.');
    var a = N(answer), b = N(starter), s = N(student);
    var targets = Object.keys(a).filter(function(k){ return !b[k] || a[k].value !== b[k].value; });
    var deleted = Object.keys(b).filter(function(k){ return !a[k]; });
    var checks = targets.map(function(k){
      return {label: a[k].object + ' · ' + (L[a[k].type] || '블록 수정'), ok: !!s[k] && s[k].value === a[k].value};
    });
    deleted.forEach(function(k){ checks.push({label: b[k].object + ' · 불필요한 블록 제거', ok: !s[k]}); });
    // 스프라이트·변수·리스트 구성이 시작 파일과 정답 파일에서 다르면 항목으로 확인
    function diffCheck(pick, addLabel, delLabel){
      var oa = pick(answer), ob = pick(starter), os = pick(student);
      oa.filter(function(n){ return ob.indexOf(n) < 0; }).forEach(function(n){ checks.push({label: addLabel + " '" + n + "'", ok: os.indexOf(n) >= 0}); });
      ob.filter(function(n){ return oa.indexOf(n) < 0; }).forEach(function(n){ checks.push({label: delLabel + " '" + n + "'", ok: os.indexOf(n) < 0}); });
    }
    diffCheck(spriteNames, '스프라이트 추가', '스프라이트 삭제');
    diffCheck(varNames, '변수 만들기', '변수 삭제');
    diffCheck(listNames, '리스트 만들기', '리스트 삭제');
    // 시작 파일에도 정답에도 없는 블록이 학생 답안에 있으면(불필요하게 추가한 블록) 별도 항목으로 감점
    var extra = Object.keys(s).filter(function(k){ return !a[k] && !b[k]; });
    if(extra.length) checks.push({label: '정답 구조에 없는 추가 블록 ' + extra.length + '개', ok: false});
    if(!checks.length) checks.push({label: '전체 블록 구조', ok: JSON.stringify(s) === JSON.stringify(a)});
    var correct = checks.filter(function(c){ return c.ok; }).length;
    return {score: Math.round(correct / checks.length * 100), correct: correct, total: checks.length, checks: checks};
  }

  /* sb3(zip) 바이트에서 project.json만 꺼내기 (fflate 필요) */
  function readProject(buf){
    var files = root.fflate.unzipSync(new Uint8Array(buf), {filter: function(f){ return f.name === 'project.json'; }});
    if(!files['project.json']) throw new Error('파일 안에 project.json이 없어요.');
    return JSON.parse(TD.decode(files['project.json']));
  }

  root.CosGrader = {normalize: normalize, normalize2: normalize2, grade: grade, readProject: readProject, LABELS: LABELS};
  if(typeof module !== 'undefined') module.exports = root.CosGrader;
})(typeof window !== 'undefined' ? window : globalThis);
