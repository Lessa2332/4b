import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

class TectonicSimulation {
  constructor() {
    this.video = document.getElementById('video-feed');
    this.canvas = document.getElementById('webgl-canvas');
    this.statusBadge = document.getElementById('status-badge');
    this.startScreen = document.getElementById('start-screen');
    this.startBtn = document.getElementById('start-btn');
    
    this.faceState = { noseX: 0, jawOpenRatio: 0, active: false };
    
    // Стабільна невелика сітка під мобільні процесори
    this.gridWidth = 35;
    this.gridHeight = 22;
    
    // Прив'язуємо клік НАЙПЕРШИМ ділом, до будь-яких важких ініціалізацій
    this.startBtn.addEventListener('click', () => this.handleStart());

    try {
      this.init3D();
    } catch (err) {
      this.logToScreen("Помилка WebGL/3D: " + err.message);
    }
    
    window.addEventListener('resize', () => this.onResize());
  }

  logToScreen(msg) {
    const box = document.getElementById('error-box');
    if (box) {
      box.style.display = 'block';
      box.innerText += '\n' + msg;
    }
  }

  init3D() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Обмежуємо для економії батареї

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0f172a, 0.025);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    
    const isMobile = aspect < 1;
    this.camera.position.set(0, -9, isMobile ? 45 : 28);
    this.camera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffdfb0, 1.3);
    dirLight.position.set(5, 15, 10);
    this.scene.add(dirLight);

    const geometry = new THREE.BoxGeometry(0.92, 0.92, 2);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    
    this.count = this.gridWidth * this.gridHeight;
    this.mesh = new THREE.InstancedMesh(geometry, material, this.count);
    
    this.dummy = new THREE.Object3D();
    this.initialData = [];
    
    let i = 0;
    const defaultColor = new THREE.Color(0x1e293b);
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const posX = (x - this.gridWidth / 2);
        const posY = (y - this.gridHeight / 2);
        this.initialData.push({ x: posX, y: posY, isOceanic: x < this.gridWidth / 2 });
        
        // Одразу ініціалізуємо базові кольори через API Three.js, уникаючи прямих мутацій буферів
        this.mesh.setColorAt(i, defaultColor);
        i++;
      }
    }
    
    this.scene.add(this.mesh);
    this.clock = new THREE.Clock();
    
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  async handleStart() {
    this.startScreen.style.display = 'none';
    this.updateUI('Доступ до камери...', 'loading');
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } 
      });
      
      this.video.srcObject = stream;
      // Важливо для iOS: запускаємо ручками після того як згоду отримано
      await this.video.play();
      
      // Не чекаємо капризних івентів браузера, йдемо прямо на завантаження ШІ
      this.updateUI('Запуск інтелекту...', 'loading');
      this.loadVisionModel();
      
    } catch (error) {
      this.updateUI('Помилка камери', 'rift');
      this.logToScreen("Камера заблокована чи відсутня: " + error.name + " - " + error.message);
    }
  }

  async loadVisionModel() {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
      );
      
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
    } catch(error) {
       this.updateUI('Збій модуля ШІ', 'rift');
       this.logToScreen("MediaPipe Crash: " + error.message);
    }
  }

  detectFace() {
    const tick = () => {
      if (this.video.readyState >= 2 && this.faceLandmarker) {
        try {
          const results = this.faceLandmarker.detectForVideo(this.video, performance.now());
          this.processFaceData(results);
        } catch(e) {
          // Придушуємо циклічні мікро-збої кадру, щоб не вішати потік
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  processFaceData(results) {
    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];
      const blendshapes = results.faceBlendshapes[0].categories;
      
      this.faceState.noseX = -(landmarks[1].x - 0.5) * 35; 
      const jawOpen = blendshapes.find(b => b.categoryName === 'jawOpen').score;
      this.faceState.jawOpenRatio = jawOpen;
      this.faceState.active = true;

      if (jawOpen > 0.22) {
        this.updateUI('РИФТОГЕНЕЗ', 'rift');
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

  animate() {
    requestAnimationFrame(this.animate);
    const time = this.clock.getElapsedTime();
    const col = new THREE.Color();
    
    let idx = 0;
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const block = this.initialData[idx];
        let targetZ = Math.sin(block.x * 0.12 + time * 0.6) * 0.12;
        
        if (block.isOceanic) col.setHex(0x1e293b); 
        else col.setHex(0x3f6212);

        if (this.faceState.active) {
          const distToFault = Math.abs(block.x - this.faceState.noseX);
          const influenceZone = 9;

          if (distToFault < influenceZone) {
            const power = 1 - (distToFault / influenceZone);

            if (this.faceState.jawOpenRatio > 0.22) {
              const depth = this.faceState.jawOpenRatio * 7 * power;
              targetZ -= depth;
              if (power > 0.3) col.lerp(new THREE.Color(0xf97316), power * this.faceState.jawOpenRatio * 1.3); 
            } else {
              const height = 6 * power * (1 - this.faceState.jawOpenRatio);
              targetZ += Math.abs(Math.sin(block.x * 0.4)) * height;
              if (targetZ > 2.5) col.lerp(new THREE.Color(0xf8fafc), (targetZ - 2.5) / 2.5); 
              else col.lerp(new THREE.Color(0x64748b), power); 
            }
          }
        }

        this.dummy.position.set(block.x, block.y, targetZ);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(idx, this.dummy.matrix);
        this.mesh.setColorAt(idx, col);

        idx++;
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    
    if (this.faceState.active) {
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this.faceState.noseX * 0.25, 0.05);
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.aspect = aspect;
    this.camera.position.z = (aspect < 1) ? 45 : 28;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Запускаємо додаток нативно без посередників
new TectonicSimulation();
