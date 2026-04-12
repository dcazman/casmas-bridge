    // ── Weather panel (uses better_forecast — current + today's forecast) ──
    async function loadWeather(){
      const body=document.getElementById('wxBody');if(!body)return;
      try{
        const r=await fetch('/weather');const d=await r.json();
        if(!d.ok){body.innerHTML='<div class="wx-error">Unavailable</div>';return;}
        const feels=d.feelsF!=null&&d.feelsF!==d.tempF?'<div class="wx-feels">feels '+d.feelsF+'°F</div>':'';
        const gust=d.gustMph?d.windMph+' / '+d.gustMph:d.windMph||'—';
        const hiLo=d.highF!=null&&d.lowF!=null?d.highF+'° / '+d.lowF+'°':'—';
        const precipColor=d.precipChance>60?'#f87171':d.precipChance>30?'#fbbf24':'#4ade80';
        body.innerHTML=\`
          <div class="wx-panel">
            <div class="wx-main">
              <div><div class="wx-temp">\${d.tempF!=null?d.tempF+'°':'—'}</div>\${feels}</div>
              \${d.forecastConditions||d.conditions?'<div style="font-size:.85rem;color:#94a3b8;margin-left:auto;text-align:right">'+(d.forecastConditions||d.conditions)+'</div>':''}
            </div>
            <div class="wx-row">
              <div class="wx-stat"><span class="wx-stat-val">\${d.humidity!=null?d.humidity+'%':'—'}</span><span class="wx-stat-lbl">Humidity</span></div>
              <div class="wx-stat"><span class="wx-stat-val">\${gust} mph</span><span class="wx-stat-lbl">Wind \${d.windDir||''}</span></div>
              <div class="wx-stat"><span class="wx-stat-val">\${d.pressureMb||'—'}</span><span class="wx-stat-lbl">Pressure mb</span></div>
              <div class="wx-stat"><span class="wx-stat-val">UV \${d.uv||'—'}</span><span class="wx-stat-lbl">Index</span></div>
              <div class="wx-stat"><span class="wx-stat-val">\${hiLo}</span><span class="wx-stat-lbl">Hi / Lo</span></div>
              <div class="wx-stat"><span class="wx-stat-val" style="color:\${precipColor}">\${d.precipChance!=null?d.precipChance+'%':'—'}</span><span class="wx-stat-lbl">Rain chance</span></div>
              \${d.rainToday?'<div class="wx-stat"><span class="wx-stat-val">'+d.rainToday+'"</span><span class="wx-stat-lbl">Rain today</span></div>':''}
              \${d.lightning?'<div class="wx-stat"><span class="wx-stat-val">⚡ '+d.lightning+'</span><span class="wx-stat-lbl">Strikes/hr</span></div>':''}
            </div>
            <div class="wx-time">Updated \${d.time} · Casmas station</div>
          </div>\`;
      }catch(e){body.innerHTML='<div class="wx-error">Could not load weather</div>';}
    }
    if(document.getElementById('wxBody')){loadWeather();setInterval(loadWeather,600000);}
