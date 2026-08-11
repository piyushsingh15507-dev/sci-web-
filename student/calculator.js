// ===================== SCIENTIFIC CALCULATOR =====================
(function(){
  let tokens = []; // {eval:'...', display:'...'}
  let mode = 'deg';

  const BUTTONS = [
    { label:'7', evalStr:'7' }, { label:'8', evalStr:'8' }, { label:'9', evalStr:'9' },
    { label:'÷', evalStr:'/', cls:'op' }, { label:'DEL', action:'del', cls:'clr' },

    { label:'4', evalStr:'4' }, { label:'5', evalStr:'5' }, { label:'6', evalStr:'6' },
    { label:'×', evalStr:'*', cls:'op' }, { label:'C', action:'clear', cls:'clr' },

    { label:'1', evalStr:'1' }, { label:'2', evalStr:'2' }, { label:'3', evalStr:'3' },
    { label:'−', evalStr:'-', cls:'op' }, { label:'(', evalStr:'(' },

    { label:'0', evalStr:'0' }, { label:'.', evalStr:'.' }, { label:'=', action:'eval', cls:'eq' },
    { label:'+', evalStr:'+', cls:'op' }, { label:')', evalStr:')' },

    { label:'sin', evalStr:'Math.sin(', display:'sin(' }, { label:'cos', evalStr:'Math.cos(', display:'cos(' },
    { label:'tan', evalStr:'Math.tan(', display:'tan(' }, { label:'√', evalStr:'Math.sqrt(', display:'√(' },
    { label:'^', evalStr:'**', cls:'op' },

    { label:'log', evalStr:'Math.log10(', display:'log(' }, { label:'ln', evalStr:'Math.log(', display:'ln(' },
    { label:'π', evalStr:'Math.PI' }, { label:'e', evalStr:'Math.E' }, { label:'%', evalStr:'/100' }
  ];

  function buildButtons(){
    const grid = document.getElementById('calc-grid');
    if(!grid) return;
    grid.innerHTML = '';
    BUTTONS.forEach(b => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if(b.cls) btn.className = b.cls;
      btn.addEventListener('click', () => handlePress(b));
      grid.appendChild(btn);
    });
  }

  function handlePress(b){
    if(b.action === 'clear'){ tokens = []; updateDisplay(); return; }
    if(b.action === 'del'){ tokens.pop(); updateDisplay(); return; }
    if(b.action === 'eval'){ evaluate(); return; }
    tokens.push({ eval: b.evalStr, display: b.display || b.evalStr });
    updateDisplay();
  }

  function updateDisplay(){
    const el = document.getElementById('calc-display');
    if(!el) return;
    el.textContent = tokens.map(t => t.display).join('') || '0';
  }

  function evaluate(){
    const el = document.getElementById('calc-display');
    let jsExpr = tokens.map(t => t.eval).join('');
    if(!jsExpr){ return; }
    // Apply degree->radian conversion for trig functions (simple, non-nested arguments)
    if(mode === 'deg'){
      jsExpr = jsExpr
        .replace(/Math\.sin\(([^()]*)\)/g, 'Math.sin(($1)*Math.PI/180)')
        .replace(/Math\.cos\(([^()]*)\)/g, 'Math.cos(($1)*Math.PI/180)')
        .replace(/Math\.tan\(([^()]*)\)/g, 'Math.tan(($1)*Math.PI/180)');
    }
    try {
      // eslint-disable-next-line no-new-func
      let result = Function('"use strict"; return (' + jsExpr + ')')();
      if(typeof result !== 'number' || !isFinite(result)) throw new Error('invalid');
      result = Math.round(result * 1e10) / 1e10;
      tokens = [{ eval: String(result), display: String(result) }];
      updateDisplay();
    } catch(err){
      el.textContent = 'Error';
      tokens = [];
    }
  }

  function init(){
    buildButtons();
    const fab = document.getElementById('calc-fab');
    const win = document.getElementById('calc-window');
    const closeBtn = document.getElementById('calc-close');
    const degBtn = document.getElementById('calc-deg');
    const radBtn = document.getElementById('calc-rad');
    if(!fab || !win) return;

    fab.addEventListener('click', () => win.classList.toggle('show'));
    closeBtn.addEventListener('click', () => win.classList.remove('show'));
    degBtn.addEventListener('click', () => { mode='deg'; degBtn.classList.add('active'); radBtn.classList.remove('active'); });
    radBtn.addEventListener('click', () => { mode='rad'; radBtn.classList.add('active'); degBtn.classList.remove('active'); });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
