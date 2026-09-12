/* Same Cesium runtime as OKO; no maps, ion, AIS or third-party requests. */
/* global Cesium */
(async () => {
  const status = document.getElementById('status');
  try {
    Cesium.Ion.defaultAccessToken = '';
    const viewer = new Cesium.Viewer('viewer', {
      baseLayer: false, globe: false, skyBox: false, skyAtmosphere: false,
      geocoder: false, baseLayerPicker: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, animation: false,
      timeline: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, shouldAnimate: false,
      requestRenderMode: true, maximumRenderTimeChange: Infinity,
      contextOptions: { webgl: { alpha: false, preserveDrawingBuffer: true } },
    });
    const scene = viewer.scene;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#0c1820');
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.fog.enabled = false;
    scene.highDynamicRange = false;
    scene.light = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(-0.3, 0.5, -0.8), intensity: 2.5,
    });
    // Identity local frame: x = bow, y = port, z = up after Cesium's glTF correction.
    const model = await Cesium.Model.fromGltfAsync({
      url: '/models/oko-tanker.glb', modelMatrix: Cesium.Matrix4.IDENTITY,
      scale: 1, allowPicking: false,
      imageBasedLighting: new Cesium.ImageBasedLighting({
        imageBasedLightingFactor: new Cesium.Cartesian2(0.8, 0.5),
      }),
    });
    scene.primitives.add(model);
    const controller = scene.screenSpaceCameraController;
    controller.enableTranslate = false;
    controller.enableLook = false;
    controller.minimumZoomDistance = 100;
    controller.maximumZoomDistance = 1100;
    controller.rotateEventTypes = [];
    controller.tiltEventTypes = [Cesium.CameraEventType.LEFT_DRAG, Cesium.CameraEventType.MIDDLE_DRAG];
    function frame(kind) {
      const narrow = window.innerWidth < 720;
      const poses = {
        perspective: [Cesium.Math.toRadians(140), Cesium.Math.toRadians(-26), narrow ? 390 : 300],
        side: [Math.PI, Cesium.Math.toRadians(-7), narrow ? 450 : 330],
        top: [Math.PI/2, Cesium.Math.toRadians(-89.9), narrow ? 390 : 350],
      };
      viewer.camera.lookAtTransform(Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(0, 0, 10)), new Cesium.HeadingPitchRange(...poses[kind]));
      document.querySelectorAll('[data-view]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.view === kind));
      });
      scene.requestRender();
    }
    document.querySelectorAll('[data-view]').forEach(button => {
      button.addEventListener('click', () => frame(button.dataset.view));
    });
    window.addEventListener('resize', () => frame(document.querySelector('[data-view][aria-pressed="true"]').dataset.view));
    frame('perspective');
    model.readyEvent.addEventListener(() => {
      status.textContent = 'Model pripravený · Blender → GLB → CesiumJS';
      document.body.dataset.modelReady = 'true';
      scene.requestRender();
    });
    scene.requestRender();
    const meta = await fetch('/models/oko-tanker.json').then(response => {
      if (!response.ok) throw new Error('Chýbajú parametre modelu.');
      return response.json();
    });
    document.getElementById('size').textContent = `${Math.round(meta.bytes / 1024)} kB`;
  } catch (error) {
    status.textContent = `Model sa nepodarilo načítať: ${error.message}`;
    document.body.dataset.modelError = 'true';
  }
})();
