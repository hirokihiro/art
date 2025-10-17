(() => {
  // 汎用ルーレットクラス（カードごとに1つ）
  class Roulette {
    constructor(opts){
      this.root = opts.root;
      this.kind = opts.kind; // 'people' | 'songs'
      this.hueRange = opts.hueRange; // [min,max]
      this.sampleList = opts.sample;

      // DOM参照
      this.textarea = this.q(`#${this.kind}-input`);
      this.countEl = this.q(`#${this.kind}-count`);
      this.applyBtn = this.q(`#${this.kind}-apply`);
      this.shuffleBtn = this.q(`#${this.kind}-shuffle`);
      this.sampleBtn = this.q(`#${this.kind}-sample`);
      this.removeChk = this.q(`#${this.kind}-remove`);
      this.spinBtn = this.q(`#${this.kind}-spin`);
      this.resultEl = this.q(`#${this.kind}-result`);
      this.historyEl = this.q(`#${this.kind}-history`);
      this.canvas = this.q(`#${this.kind}-wheel`);
      this.ctx = this.canvas.getContext("2d", { alpha: false });

      // 追加入力
      this.addInput = this.q(`#${this.kind}-add`);
      this.addBtn = this.q(`#${this.kind}-add-btn`);
      this.clearBtn = this.q(`#${this.kind}-clear`);

      // 状態
      this.items = [];
      this.isSpinning = false;
      this.currentRotation = 0; // deg
      this.SPIN_MS = 4200;
      this.EASE = "cubic-bezier(.2,.8,.1,1)";

      // ユーザーの動作設定に配慮（省モーション）
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.SPIN_MS = 1200;
        this.EASE = "linear";
      }

      // 初期化
      this.loadSample();
      this.bindEvents();
      this.resizeCanvasToDPR();
      this.applyFromTextarea();
    }

    q(sel){ return this.root.querySelector(sel); }

    bindEvents(){
      this.textarea.addEventListener("input", () => this.updateCount(), { passive: true });
      this.applyBtn.addEventListener("click", () => {
        this.applyFromTextarea();
        this.announce("ルーレットを更新しました");
      });
      this.shuffleBtn.addEventListener("click", () => {
        if (this.items.length < 2) return;
        this.items = this.shuffle([...this.items]);
        this.draw();
        this.announce("シャッフルしました");
      });
      this.sampleBtn.addEventListener("click", () => {
        this.loadSample();
        this.applyFromTextarea();
        this.announce("サンプルを読み込みました");
      });
      this.spinBtn.addEventListener("click", () => this.spin());
      this.canvas.addEventListener("transitionend", (e) => this.onSpinEnd(e));
      window.addEventListener("resize", () => this.onResize());
      window.addEventListener("orientationchange", () => {
        // iOSでの回転時の一時的なズレを抑制
        setTimeout(() => this.onResize(), 220);
      });

      // 追加入力のイベント
      this.addBtn.addEventListener("click", () => this.addFromInput());
      this.addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          this.addFromInput();
        }
      });
      this.clearBtn.addEventListener("click", () => this.clearAll());
    }

    onResize(){
      const was = this.canvas.style.transition;
      this.canvas.style.transition = "none";
      const deg = this.currentRotation % 360;
      this.canvas.style.transform = `rotate(${deg}deg)`;
      this.resizeCanvasToDPR();
      requestAnimationFrame(() => { this.canvas.style.transition = was || ""; });
    }

    loadSample(){
      this.textarea.value = this.sampleList.join("\n");
      this.updateCount();
    }

    parseLines(text){
      return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }

    updateCount(){
      const n = this.parseLines(this.textarea.value).length;
      this.countEl.textContent = `${n}件`;
    }

    applyFromTextarea(){
      const lines = this.parseLines(this.textarea.value);
      this.items = lines;
      this.resetRotation();
      this.draw();
    }

    // 追加入力をテキストエリアに反映
    addFromInput(){
      const raw = (this.addInput.value || "").trim();
      if (!raw) return;

      // カンマ(,)、読点(、)、改行で分割して複数追加可
      const parts = raw.split(/\r?\n|,|、/).map(s => s.trim()).filter(Boolean);
      if (!parts.length) return;

      const current = this.textarea.value.trim();
      const appended = (current ? current + "\n" : "") + parts.join("\n");
      this.textarea.value = appended;

      this.addInput.value = "";
      this.updateCount();
      this.applyFromTextarea();
      this.announce(`${parts.length}件 追加しました`);
    }

    clearAll(){
      if (!this.textarea.value.trim()) return;
      if (!confirm("このリストを全て削除しますか？")) return;
      this.textarea.value = "";
      this.updateCount();
      this.applyFromTextarea();
      this.historyEl.innerHTML = "";
      this.announce("リストを空にしました");
    }

    resizeCanvasToDPR(){
      const wrap = this.canvas.parentElement;
      // スマホでの余白・固定ボタンを考慮して安全マージンを少し増やす
      const size = Math.min(520, Math.max(240, wrap.clientWidth - 28));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      this.canvas.classList.add("wheel");
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
      this.canvas.width = Math.round(size * dpr);
      this.canvas.height = Math.round(size * dpr);
      this.ctx.setTransform(1,0,0,1,0,0);
      this.ctx.scale(dpr, dpr);
      this.draw();
    }

    // 項目ごとの安定色（人=青帯、曲=緑帯）
    colorFor(label){
      const [hMin, hMax] = this.hueRange;
      const h = hMin + this.hash01(label) * (hMax - hMin);
      const s = 65 + this.hash01(label + "s") * 10;
      const l = 48 + this.hash01(label + "l") * 10;
      return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
    }
    hash01(str){
      let h = 2166136261 >>> 0; // FNV-1a
      for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0) / 4294967295;
    }

    draw(){
      const ctx = this.ctx;
      const list = this.items;
      const N = list.length;
      const size = Math.min(this.canvas.clientWidth, this.canvas.clientHeight);
      const r = (size / 2) - 8;
      const cx = size / 2;
      const cy = size / 2;
      const seg = (Math.PI * 2) / Math.max(1, N);

      ctx.clearRect(0,0,this.canvas.clientWidth,this.canvas.clientHeight);
      ctx.save();
      ctx.translate(cx, cy);

      // 縁
      this.circle(0,0,r+6,"#081028");
      ctx.lineWidth = 8;
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      ctx.beginPath(); ctx.arc(0,0,r+2,0,Math.PI*2); ctx.stroke();

      // セグメント
      for (let i=0;i<N;i++){
        const start = -Math.PI/2 + i*seg;
        const end = start + seg;
        const label = list[i];

        // 塗り
        ctx.beginPath();
        ctx.moveTo(0,0);
        ctx.arc(0,0,r,start,end,false);
        ctx.closePath();
        ctx.fillStyle = this.colorFor(label);
        ctx.fill();

        // 仕切り
        ctx.strokeStyle = "rgba(0,0,0,.25)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r,start,end,false); ctx.closePath(); ctx.stroke();

        // ラベル
        const arcChord = 2 * r * Math.sin(seg/2) - 18;
        const fontSize = Math.max(11, Math.min(18, arcChord / 9));
        const short = this.ellipsis(label, Math.max(6, Math.floor(arcChord / (fontSize * 0.9))));
        ctx.save();
        ctx.rotate(start + seg/2);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif`;
        const radiusForText = r * 0.68;
        ctx.translate(radiusForText, 0);
        ctx.rotate(Math.PI/2);
        ctx.fillText(short, 0, 0);
        ctx.restore();
      }

      // 中央キャップ
      this.circle(0,0,r*0.18,"rgba(255,255,255,.85)");
      ctx.restore();
    }

    circle(x,y,rad,fill){
      const ctx = this.ctx;
      ctx.beginPath(); ctx.arc(x,y,rad,0,Math.PI*2); ctx.fillStyle = fill; ctx.fill();
    }

    ellipsis(str, maxChars){
      if (str.length <= maxChars) return str;
      return str.slice(0, maxChars - 1) + "…";
    }

    shuffle(arr){
      for (let i=arr.length-1;i>0;i--){
        const j = (Math.random() * (i+1)) | 0;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    resetRotation(){
      this.canvas.style.transition = "none";
      this.currentRotation = 0;
      this.canvas.style.transform = `rotate(0deg)`;
      requestAnimationFrame(() => (this.canvas.style.transition = ""));
    }

    spin(){
      if (this.isSpinning) return;
      if (this.items.length < 2){
        alert("項目が足りません。2つ以上入力してください。");
        return;
      }
      this.isSpinning = true;
      this.resultEl.textContent = "回転中…";

      const N = this.items.length;
      const segDeg = 360 / N;
      const pickIndex = (Math.random() * N) | 0;

      const targetRotNorm = (N - pickIndex - 0.5) * segDeg; // ポインタ中央へ
      const extraTurns = 5 + Math.random() * 3;
      const base = this.currentRotation + extraTurns * 360;
      const baseNorm = ((base % 360) + 360) % 360;
      const delta = (targetRotNorm - baseNorm + 360) % 360;
      const finalRotation = base + delta;

      this.currentRotation = finalRotation;
      this.canvas.style.transition = `transform ${this.SPIN_MS}ms ${this.EASE}`;
      this.canvas.style.transform = `rotate(${finalRotation}deg)`;
    }

    onSpinEnd(e){
      if (e.propertyName !== "transform") return;

      const deg = ((this.currentRotation % 360) + 360) % 360;
      this.canvas.style.transition = "none";
      this.canvas.style.transform = `rotate(${deg}deg)`;
      requestAnimationFrame(() => (this.canvas.style.transition = ""));

      const N = this.items.length;
      const segDeg = 360 / N;
      const index = ((Math.floor(N - (deg / segDeg)) % N) + N) % N;
      const picked = this.items[index];

      const icon = this.kind === "people" ? "👤" : "🎵";
      this.resultEl.textContent = `🎉 ${icon}「${picked}」 に決定！`;
      this.addHistory(`${icon} ${picked}`);

      if (this.removeChk.checked){
        // テキストエリアから先頭一致の1件を削除
        const lines = this.parseLines(this.textarea.value);
        const pos = lines.indexOf(picked);
        if (pos >= 0) lines.splice(pos, 1);
        this.textarea.value = lines.join("\n");
        this.updateCount();

        // 再構築
        this.items = lines;
        setTimeout(() => { this.draw(); this.resetRotation(); }, 60);
      }

      this.isSpinning = false;
    }

    addHistory(text){
      const li = document.createElement("li");
      li.textContent = text;
      this.historyEl.prepend(li);
      const max = 20;
      while (this.historyEl.children.length > max) this.historyEl.lastChild.remove();
    }

    announce(msg){
      this.resultEl.textContent = msg;
      setTimeout(() => { if (this.resultEl.textContent === msg) this.resultEl.textContent = ""; }, 1200);
    }
  }

  // --- 起動 ---
  const people = new Roulette({
    root: document,
    kind: "people",
    hueRange: [210, 255], // 青帯
    sample: ["小林さん","田中くん","はるか","りく","さくら","Hiro","Mina"]
  });
  const songs = new Roulette({
    root: document,
    kind: "songs",
    hueRange: [120, 165], // 緑帯
    sample: [
      "Pretender (Official髭男dism)",
      "Lemon (米津玄師)",
      "アイドル (YOASOBI)",
      "うっせぇわ (Ado)",
      "花に亡霊 (ヨルシカ)",
      "夜に駆ける (YOASOBI)",
      "廻廻奇譚 (Eve)"
    ]
  });

  // 両方同時に回す
  document.getElementById('both-spin').addEventListener('click', async () => {
    // 既存の人・曲ルーレットの回転処理を呼び出す
    const peopleResult = await spinPeopleWheel(); // 人ルーレットの結果取得関数
    const songsResult = await spinSongsWheel();   // 曲ルーレットの結果取得関数

    // 結果を下部に表示
    const bothResult = document.getElementById('both-result');
    bothResult.innerHTML = `
      <span>👤 <strong>${peopleResult}</strong> × 🎵 <strong>${songsResult}</strong></span>
    `;
  });
})();
