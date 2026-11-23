import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id)=>document.getElementById(id);
const loading=$('loading'), game=$('game'), bar=$('progressBar'), status=$('loadStatus');
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x030713); scene.fog=new THREE.FogExp2(0x07101f,0.018);
const camera=new THREE.PerspectiveCamera(64,innerWidth/innerHeight,.1,450);
const renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6)); renderer.setSize(innerWidth,innerHeight); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.25;
scene.add(new THREE.HemisphereLight(0x9acaff,0x100b25,1.25));
const moon=new THREE.DirectionalLight(0x8bbaff,1.3); moon.position.set(-25,45,20); moon.castShadow=true; scene.add(moon);
const pink=new THREE.PointLight(0xff237f,35,90); pink.position.set(12,8,-8); scene.add(pink);
const cyan=new THREE.PointLight(0x00dfff,30,100); cyan.position.set(-18,9,12); scene.add(cyan);
const loader=new GLTFLoader();
const player=new THREE.Group(); scene.add(player);
const npcGroup=new THREE.Group(); scene.add(npcGroup);
const pickups=[]; const npcs=[]; const keys={};
let playerModel=null, running=false, moveX=0, moveY=0, gameReady=false, missionCount=0;
const worldSize=150;
const ground=new THREE.Mesh(new THREE.PlaneGeometry(worldSize,worldSize),new THREE.MeshStandardMaterial({color:0x080d19,roughness:.9,metalness:.15})); ground.rotation.x=-Math.PI/2; ground.position.y=-.04; ground.receiveShadow=true; scene.add(ground);
// Neon street grid and sidewalks
function box(w,h,d,x,y,z,color,emissive=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.72,metalness:.25,emissive:emissive||color,emissiveIntensity:emissive?0.35:0.025}));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;}
for(let i=-5;i<=5;i++){
  const road1=box(5,.06,worldSize,i*14,.005,0,0x101827); road1.material.roughness=.98;
  const road2=box(worldSize,.06,5,0,.006,i*14,0x101827); road2.material.roughness=.98;
  for(let j=-5;j<=5;j++){
    const x=i*14, z=j*14;
    if(Math.abs(x)<8&&Math.abs(z)<8) continue;
    const height=5+Math.random()*17, width=5+Math.random()*4, depth=5+Math.random()*4;
    const b=box(width,height,depth,x+(Math.random()-.5)*2,height/2,z+(Math.random()-.5)*2,[0x111a30,0x16182c,0x17172b,0x10202d][Math.floor(Math.random()*4)]);
    const neon=new THREE.Mesh(new THREE.BoxGeometry(width*.72,.16,.12),new THREE.MeshBasicMaterial({color:Math.random()>.5?0x00dfff:0xff2786}));neon.position.set(b.position.x,height*.65,b.position.z+depth/2+.07);scene.add(neon);
    for(let wy=2;wy<height-1;wy+=2.8) for(let wx=-width/2+1;wx<width/2;wx+=1.8){const win=new THREE.Mesh(new THREE.PlaneGeometry(.75,1.1),new THREE.MeshBasicMaterial({color:Math.random()>.5?0x28c9e9:0xff4b9d,emissive:0x112233,transparent:true,opacity:.72}));win.position.set(b.position.x+wx,wy,b.position.z+depth/2+.08);scene.add(win);}
  }
}
// Street lamps, markings, manhole props
for(let i=-5;i<=5;i++) for(let j=-5;j<=5;j++){
  const x=i*14+5.2,z=j*14+5.2;
  if(Math.random()<.55){const pole=box(.13,4,.13,x,2,z,0x202d40);const lamp=new THREE.PointLight(0x5deaff,7,12);lamp.position.set(x,4.2,z);scene.add(lamp);const bulb=new THREE.Mesh(new THREE.SphereGeometry(.16,8,8),new THREE.MeshBasicMaterial({color:0x8ef7ff}));bulb.position.copy(lamp.position);scene.add(bulb);}
}
// Distant skyline haze
const stars=new THREE.BufferGeometry(), starPos=[];for(let i=0;i<800;i++)starPos.push((Math.random()-.5)*260,20+Math.random()*75,(Math.random()-.5)*260);stars.setAttribute('position',new THREE.Float32BufferAttribute(starPos,3));scene.add(new THREE.Points(stars,new THREE.PointsMaterial({color:0x9adfff,size:.22,transparent:true,opacity:.7})));

function addNPC(x,z,index){const g=new THREE.Group();const coat=new THREE.Mesh(new THREE.CapsuleGeometry(.32,.68,4,8),new THREE.MeshStandardMaterial({color:[0x263b5e,0x552746,0x24504d,0x53412a][index%4],roughness:.75}));coat.position.y=.82;coat.castShadow=true;g.add(coat);const head=new THREE.Mesh(new THREE.SphereGeometry(.23,12,10),new THREE.MeshStandardMaterial({color:0xb98570}));head.position.y=1.48;g.add(head);const glow=new THREE.PointLight(index%2?0xff3b91:0x00cfff,1.2,4);glow.position.y=1.7;g.add(glow);g.position.set(x,0,z);npcGroup.add(g);npcs.push({g,angle:Math.random()*6.28,speed:.45+Math.random()*.45,react:0,home:new THREE.Vector3(x,0,z),phase:Math.random()*6});}
for(let i=0;i<30;i++){const a=Math.random()*Math.PI*2,r=9+Math.random()*52;addNPC(Math.cos(a)*r,Math.sin(a)*r,i);}
function addPickup(x,z){const g=new THREE.Group();const ring=new THREE.Mesh(new THREE.TorusGeometry(.58,.06,8,28),new THREE.MeshBasicMaterial({color:0xff3c99}));ring.rotation.x=Math.PI/2;g.add(ring);const core=new THREE.Mesh(new THREE.OctahedronGeometry(.27),new THREE.MeshBasicMaterial({color:0x7cf8ff}));g.add(core);g.position.set(x,.9,z);scene.add(g);pickups.push(g);}
for(let i=0;i<12;i++){const a=i*2.4,r=12+(i%4)*9;addPickup(Math.cos(a)*r,Math.sin(a)*r);}

async function loadModels(){
  status.textContent='ĐANG TẢI THÀNH PHỐ 3D...';bar.style.width='8%';
  try{const city=await loader.loadAsync('assets/japan_cyberpunk_scene.glb');city.scene.scale.setScalar(1.0);city.scene.position.set(0,0,0);city.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(city.scene);}catch(e){console.warn('City GLB skipped',e);}
  bar.style.width='48%';status.textContent='ĐANG TẢI NHÂN VẬT LUCIA...';
  try{const gltf=await loader.loadAsync('assets/gta_6_lucia.glb');playerModel=gltf.scene;const bb=new THREE.Box3().setFromObject(playerModel);const size=bb.getSize(new THREE.Vector3());const scale=1.62/Math.max(size.y,1);playerModel.scale.setScalar(scale);playerModel.position.y=-bb.min.y*scale;playerModel.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});player.add(playerModel);}
  catch(e){console.warn('Lucia model skipped',e);const body=new THREE.Mesh(new THREE.CapsuleGeometry(.35,.85,6,10),new THREE.MeshStandardMaterial({color:0x242d48}));body.position.y=.9;player.add(body);}
  bar.style.width='82%';status.textContent='ĐANG LẮP ĐẶT VẬT THỂ ĐƯỜNG PHỐ...';
  try{const prop=await loader.loadAsync('assets/lowpoly_realistic_manhole_vent_set.glb');const proto=prop.scene;for(let i=0;i<18;i++){const p=proto.clone(true);p.scale.setScalar(.7);p.position.set((Math.random()-.5)*110,.04,(Math.random()-.5)*110);p.rotation.y=Math.random()*Math.PI*2;scene.add(p);}}catch(e){console.warn('Props skipped',e);}
  bar.style.width='100%';status.textContent='SẴN SÀNG';await new Promise(r=>setTimeout(r,550));loading.classList.add('hidden');game.classList.remove('hidden');gameReady=true;toast('Chào mừng đến Night City. Hãy khám phá thành phố!');
}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2300);}

// Touch joystick
const joy=$('joystick'),stick=$('stick');let joyId=null,joyRect=null;
function setJoy(e){const r=joy.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;let dx=e.clientX-cx,dy=e.clientY-cy;const max=37,len=Math.hypot(dx,dy)||1;if(len>max){dx=dx/len*max;dy=dy/len*max;}stick.style.transform=`translate(${dx}px,${dy}px)`;moveX=dx/max;moveY=dy/max;}
joy.addEventListener('pointerdown',e=>{joyId=e.pointerId;joy.setPointerCapture(joyId);setJoy(e);});joy.addEventListener('pointermove',e=>{if(e.pointerId===joyId)setJoy(e);});function endJoy(e){if(e.pointerId===joyId){joyId=null;moveX=moveY=0;stick.style.transform='translate(0,0)';}}joy.addEventListener('pointerup',endJoy);joy.addEventListener('pointercancel',endJoy);
$('runBtn').addEventListener('pointerdown',()=>running=true);['pointerup','pointercancel','pointerleave'].forEach(ev=>$('runBtn').addEventListener(ev,()=>running=false));
$('interactBtn').addEventListener('click',()=>{let nearest=null,d=3.5;for(const n of npcs){const q=n.g.position.distanceTo(player.position);if(q<d){nearest=n;d=q;}}if(nearest){nearest.react=2.6;nearest.angle=Math.atan2(nearest.g.position.x-player.position.x,nearest.g.position.z-player.position.z);toast('NPC giật mình và lùi lại!');}else{toast('Không có ai ở gần để tương tác.');}});
addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if(e.key==='Shift')running=true;if(e.key==='e')$('interactBtn').click();});addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;if(e.key==='Shift')running=false;});

const map=$('minimap'),ctx=map.getContext('2d');
function drawMap(){const w=map.width,h=map.height,cx=w/2,cy=h/2;ctx.clearRect(0,0,w,h);ctx.fillStyle='#07111e';ctx.fillRect(0,0,w,h);ctx.save();ctx.translate(cx,cy);ctx.strokeStyle='#2b5165';ctx.lineWidth=5;for(let i=-3;i<=3;i++){ctx.beginPath();ctx.moveTo(i*22,-90);ctx.lineTo(i*22,90);ctx.stroke();ctx.beginPath();ctx.moveTo(-90,i*22);ctx.lineTo(90,i*22);ctx.stroke();}for(const p of pickups){const x=(p.position.x-player.position.x)*1.05,y=(p.position.z-player.position.z)*1.05;if(Math.abs(x)<85&&Math.abs(y)<85){ctx.fillStyle='#ff4b9c';ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill();}}ctx.fillStyle='#79f7ff';ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();ctx.restore();}

const clock=new THREE.Clock();const forward=new THREE.Vector3(),right=new THREE.Vector3(),desired=new THREE.Vector3();
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04);if(gameReady){let x=moveX,y=moveY;if(keys.a||keys.arrowleft)x-=1;if(keys.d||keys.arrowright)x+=1;if(keys.w||keys.arrowup)y-=1;if(keys.s||keys.arrowdown)y+=1;desired.set(x,0,y);if(desired.length()>1)desired.normalize();const speed=running?8.2:4.4;if(desired.lengthSq()>0.01){player.position.addScaledVector(desired,speed*dt);player.rotation.y=Math.atan2(desired.x,desired.z);if(playerModel)playerModel.position.y=Math.max(0,playerModel.position.y+Math.sin(performance.now()*.012)*.002);}player.position.x=THREE.MathUtils.clamp(player.position.x,-68,68);player.position.z=THREE.MathUtils.clamp(player.position.z,-68,68);
  for(const n of npcs){n.phase+=dt*5;if(n.react>0){n.react-=dt;const away=new THREE.Vector3().subVectors(n.g.position,player.position);away.y=0;if(away.lengthSq()>.01)n.g.position.addScaledVector(away.normalize(),dt*3.8); }else{n.angle+=Math.sin(performance.now()*.0004+n.phase)*dt*.2;const target=new THREE.Vector3(n.home.x+Math.sin(n.angle)*2,0,n.home.z+Math.cos(n.angle)*2);n.g.position.lerp(target,dt*.35);}n.g.position.x=THREE.MathUtils.clamp(n.g.position.x,-70,70);n.g.position.z=THREE.MathUtils.clamp(n.g.position.z,-70,70);n.g.children[0].position.y=.82+Math.sin(n.phase)*.025;}
  for(let i=pickups.length-1;i>=0;i--){const p=pickups[i];p.rotation.y+=dt*1.4;p.position.y=.9+Math.sin(performance.now()*.002+i)*.12;if(p.position.distanceTo(player.position)<1.5){scene.remove(p);pickups.splice(i,1);missionCount++;$('missionText').textContent=`Đã tìm thấy ${missionCount}/12 điểm sáng`;$('objectiveText').textContent=missionCount>=12?'Khu phố đã được khám phá!':'Tìm điểm sáng tiếp theo';toast('Đã thu thập điểm sáng neon!');}}
  camera.position.lerp(new THREE.Vector3(player.position.x,player.position.y+6.5,player.position.z+10),1-Math.pow(.001,dt));camera.lookAt(player.position.x,player.position.y+1.1,player.position.z);
  drawMap();}
  renderer.render(scene,camera);
}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
loadModels();animate();
