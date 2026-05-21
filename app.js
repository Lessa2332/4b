import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

class TectonicSimulation {
  constructor() {
    this.video = document.getElementById('video-feed');
    this.canvas = document.getElementById('webgl-canvas');
    this.statusBadge = document.getElementById('status-badge');
    
    // Стан обличчя: тепер використовуємо готові метрики нейромережі
    this.faceState = { noseX: 0, jawOpenRatio: 0, active: false };
    
    // Параметри 3D сітки
    this.gridWidth = 65;
    this.gridHeight = 40;
    
    this.init3D();
    this.initAI();
    
    window.addEventListener('resize', () => this.onResize());
  }

  // --- 1. Налаштування 3D середовища ---
  init3D() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0f172a, 0.025);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, -12, 35);
    this.camera.lookAt(0, 0, 0);

    // Додаємо професійне освітлення, щоб плити мали об'єм та тіні
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffdfb0, 1.5);
    dirLight.position.set(10, 20, 15);
    this.scene.add(dirLight);

    // Створюємо масив плит (MeshStandardMaterial гарно відбиває світло)
    const geometry = new THREE.BoxGeometry(0.95, 0.95, 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
    
    this.count = this.gridWidth * this.gridHeight;
    this.mesh = new THREE.InstancedMesh(geometry, material, this.count);
    
    this.dummy = new THREE.Object3D();
    this.initialData = [];
    
    let i = 0;
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const posX = (x - this.gridWidth / 2);
        const posY = (y - this.gridHeight / 2);
        // Записуємо позицію та тип плити (Океанічна чи Материкова)
        this.initialData.push({ x: posX, y: posY, isOceanic: x < this.gridWidth / 2 });
        i++;
      }
    }
    
    this.scene.add(this.mesh);
    this.clock = new THREE.Clock();
    
    // Запуск рендер-циклу
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // --- 2. Ініціалізація сучасної нейромережі MediaPipe ---
  async initAI() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      this.video.srcObject = stream;
      this.video.addEventListener('loadeddata', () => this.loadVisionModel());
    } catch (error) {
      this.updateUI('Камера не знайдена', 'loading');
      console.error("Помилка доступу до камери:", error);
    }
  }

  async loadVisionModel() {
    // Завантажуємо ядро WebAssembly
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
    );
    
    // Створюємо трекер із підтримкою Blendshapes (зчитування міміки)
    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      runningMode: "VIDEO",
      numFaces: 1
    });

    this.updateUI('КОЛІЗІЯ (ГОРИ)', 'collision');
    this.detectFace();
  }

  detectFace() {
    let lastVideoTime = -1;
    const tick = () => {
      if (this.video.currentTime !== lastVideoTime) {
        const results = this.faceLandmarker.detectForVideo(this.video, performance.now());
        this.processFaceData(results);
        lastVideoTime = this.video.currentTime;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  processFaceData(results) {
    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];
      const blendshapes = results.faceBlendshapes[0].categories;
      
      // Мапимо позицію носа у 3D простір
      this.faceState.noseX = -(landmarks[1].x - 0.5) * 60; 
      
      // Більше ніякої математики! Нейромережа сама віддає параметр jawOpen (від 0 до 1)
      const jawOpen = blendshapes.find(b => b.categoryName === 'jawOpen').score;
      this.faceState.jawOpenRatio = jawOpen;
      this.faceState.active = true;

      // Оновлюємо UI залежно від міміки
      if (jawOpen > 0.25) {
        this.updateUI('РИФТОГЕНЕЗ (РОЗХОДЖЕННЯ)', 'rift');
      } else {
        this.updateUI('КОЛІЗІЯ (ГОРИ)', 'collision');
      }
    } else {
      this.faceState.active = false;
    }
  }

  updateUI(text, state) {
    if (this.statusBadge.innerText !== text) {
      this.statusBadge.innerText = text;
      this.statusBadge.className = `status ${state}`;
    }
  }

  // --- 3. Головна логіка анімації плит ---
  animate() {
    requestAnimationFrame(this.animate);
    const time = this.clock.getElapsedTime();
    const col = new THREE.Color();
    
    let idx = 0;
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const block = this.initialData[idx];
        let targetZ = Math.sin(block.x * 0.1 + time * 0.5) * 0.15; // Легке дихання Землі
        
        // Базові кольори: Океанічна плита (темно-синя) і Материкова (оливкова)
        if (block.isOceanic) col.setHex(0x1e293b); 
        else col.setHex(0x3f6212);

        if (this.faceState.active) {
          const distToFault = Math.abs(block.x - this.faceState.noseX);
          const influenceZone = 12;

          if (distToFault < influenceZone) {
            const power = 1 - (distToFault / influenceZone);

            if (this.faceState.jawOpenRatio > 0.25) {
              // --- Дивергенція (Рифт) ---
              const depth = this.faceState.jawOpenRatio * 8 * power;
              targetZ -= depth;
              
              if (power > 0.3) {
                // Фарбуємо дно розлому в лаву
                col.lerp(new THREE.Color(0xf97316), power * this.faceState.jawOpenRatio * 1.5); 
              }
            } else {
              // --- Конвергенція (Гори) ---
              const height = 7 * power * (1 - this.faceState.jawOpenRatio);
              targetZ += Math.abs(Math.sin(block.x * 0.5)) * height;
              
              if (targetZ > 3.0) {
                // Засніжені вершини
                col.lerp(new THREE.Color(0xf8fafc), (targetZ - 3.0) / 3); 
              } else {
                // Скелясті схили
                col.lerp(new THREE.Color(0x64748b), power); 
              }
            }
          }
        }

        // Оновлюємо матрицю та колір інстансу
        this.dummy.position.set(block.x, block.y, targetZ);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(idx, this.dummy.matrix);
        this.mesh.setColorAt(idx, col);

        idx++;
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    
    // Динамічна камера: трохи слідкує за центром розлому
    if (this.faceState.active) {
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this.faceState.noseX * 0.3, 0.05);
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Запускаємо додаток після завантаження сторінки
window.onload = () => new TectonicSimulation();
