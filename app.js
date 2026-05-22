import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

class TectonicSimulation {
  constructor() {
    this.video = document.getElementById('video-feed');
    this.canvas = document.getElementById('webgl-canvas');
    this.statusBadge = document.getElementById('status-badge');
    
    this.faceState = { noseX: 0, jawOpenRatio: 0, active: false };
    
    // Трохи зменшили сітку, щоб легше рендерилась на мобільних
    this.gridWidth = 55;
    this.gridHeight = 35;
    
    this.init3D();
    this.initAI();
    
    window.addEventListener('resize', () => this.onResize());
  }

  init3D() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0f172a, 0.02);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    
    // АДАПТИВНІСТЬ: Якщо це телефон (вертикальний екран), віддаляємо камеру на Z=55
    const isMobile = aspect < 1;
    this.camera.position.set(0, -10, isMobile ? 55 : 35);
    this.camera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffdfb0, 1.5);
    dirLight.position.set(10, 20, 15);
    this.scene.add(dirLight);

    const geometry = new THREE.BoxGeometry(0.95, 0.95, 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    
    this.count = this.gridWidth * this.gridHeight;
    this.mesh = new THREE.InstancedMesh(geometry, material, this.count);
    
    // БЕЗПЕКА ДЛЯ THREE.JS: Ініціалізуємо буфер кольорів одразу, щоб уникнути крашів
    const colorArray = new Float32Array(this.count * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
    
    this.dummy = new THREE.Object3D();
    this.initialData = [];
    
    let i = 0;
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const posX = (x - this.gridWidth / 2);
        const posY = (y - this.gridHeight / 2);
        this.initialData.push({ x: posX, y: posY, isOceanic: x < this.gridWidth / 2 });
        i++;
      }
    }
    
    this.scene.add(this.mesh);
    this.clock = new THREE.Clock();
    
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  async initAI() {
    try {
      // Запитуємо доступ до камери
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480, facingMode: 'user' } 
      });
      this.video.srcObject = stream;
      
      // На iOS треба явно викликати play()
      this.video.play().catch(e => console.error("Помилка автоплею:", e));
      
      this.video.addEventListener('loadeddata', () => {
        this.updateUI('Завантаження нейромережі...', 'loading');
        this.loadVisionModel();
      });
    } catch (error) {
      this.updateUI('Дайте доступ до камери', 'rift');
      console.error("Помилка доступу до камери:", error);
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
    } catch(err) {
       this.updateUI('Помилка завантаження ШІ', 'rift');
    }
  }

  detectFace() {
    let lastVideoTime = -1;
    const tick = () => {
      if (this.video.currentTime !== lastVideoTime && this.faceLandmarker) {
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
      
      this.faceState.noseX = -(landmarks[1].x - 0.5) * 50; 
      
      const jawOpen = blendshapes.find(b => b.categoryName === 'jawOpen').score;
      this.faceState.jawOpenRatio = jawOpen;
      this.faceState.active = true;

      if (jawOpen > 0.25) {
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
        let targetZ = Math.sin(block.x * 0.1 + time * 0.5) * 0.15;
        
        if (block.isOceanic) col.setHex(0x1e293b); 
        else col.setHex(0x3f6212);

        if (this.faceState.active) {
          const distToFault = Math.abs(block.x - this.faceState.noseX);
          const influenceZone = 12;

          if (distToFault < influenceZone) {
            const power = 1 - (distToFault / influenceZone);

            if (this.faceState.jawOpenRatio > 0.25) {
              const depth = this.faceState.jawOpenRatio * 8 * power;
              targetZ -= depth;
              
              if (power > 0.3) {
                col.lerp(new THREE.Color(0xf97316), power * this.faceState.jawOpenRatio * 1.5); 
              }
            } else {
              const height = 7 * power * (1 - this.faceState.jawOpenRatio);
              targetZ += Math.abs(Math.sin(block.x * 0.5)) * height;
              
              if (targetZ > 3.0) {
                col.lerp(new THREE.Color(0xf8fafc), (targetZ - 3.0) / 3); 
              } else {
                col.lerp(new THREE.Color(0x64748b), power); 
              }
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
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this.faceState.noseX * 0.3, 0.05);
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.aspect = aspect;
    // При перевороті екрана на ходу перераховуємо дистанцію
    const isMobile = aspect < 1;
    this.camera.position.z = isMobile ? 55 : 35;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

window.onload = () => new TectonicSimulation();
