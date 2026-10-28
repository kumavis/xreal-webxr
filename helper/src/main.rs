mod fusion;
use ar_drivers::{nreal_air::NrealAir, ARGlasses, DisplayMode, GlassesEvent};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use fusion::Fusion;
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, RwLock,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
struct Pose {
    connected: bool,
    calibrated: bool,
    model: String,
    quaternion: [f32; 4],
    sample: u64,
    age_ms: u64,
    stereo: bool,
    status: String,
}
struct Command {
    name: String,
    reply: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
}
impl From<&str> for Command {
    fn from(name: &str) -> Self {
        Self {
            name: name.into(),
            reply: None,
        }
    }
}
#[derive(Default)]
struct DisplayRestore {
    original: Option<u8>,
    changed: bool,
}
struct Shared {
    pose: Pose,
    updated: Instant,
    dev_build_seen: Option<String>,
}
#[derive(Clone)]
struct App {
    shared: Arc<RwLock<Shared>>,
    commands: mpsc::Sender<Command>,
    stopping: Arc<AtomicBool>,
}
impl App {
    fn snapshot(&self) -> Pose {
        let data = self.shared.read().unwrap();
        let mut pose = data.pose.clone();
        pose.age_ms = data.updated.elapsed().as_millis() as u64;
        if pose.age_ms > 500 {
            pose.calibrated = false;
        }
        pose
    }
}
fn initial() -> Pose {
    Pose {
        connected: false,
        calibrated: false,
        model: String::new(),
        quaternion: [0., 0., 0., 1.],
        sample: 0,
        age_ms: 0,
        stereo: false,
        status: "Connecting to glasses".into(),
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help") {
        println!("xreal-webxr [--probe | --simulate | --mono]\nDefault: local bridge on 127.0.0.1:4242; no display change until Stereo is clicked.\n--probe: read sensors for 6 seconds, then exit. --mono: restore mirrored display and exit.");
        return;
    }
    if args.iter().any(|a| a == "--mono") {
        let mut g = NrealAir::new().expect("Cannot open XREAL glasses");
        g.set_display_mode(DisplayMode::SameOnBoth)
            .expect("Cannot restore display");
        println!("Restored mirrored display");
        return;
    }
    let (tx, rx) = mpsc::channel();
    let app = App {
        shared: Arc::new(RwLock::new(Shared {
            pose: initial(),
            updated: Instant::now(),
            dev_build_seen: None,
        })),
        commands: tx,
        stopping: Arc::new(AtomicBool::new(false)),
    };
    let probe = args.iter().any(|a| a == "--probe");
    let simulate = args.iter().any(|a| a == "--simulate");
    // Bind before taking hardware ownership; a second process fails without touching the glasses.
    let listener = if probe {
        None
    } else {
        Some(
            tokio::net::TcpListener::bind("127.0.0.1:4242")
                .await
                .expect("Port 4242 is already in use"),
        )
    };
    let sensor_app = app.clone();
    let worker = std::thread::spawn(move || {
        let mut display = DisplayRestore::default();
        supervise(&sensor_app, &rx, probe, || {
            sensor_loop(sensor_app.clone(), &rx, simulate, probe, &mut display)
        });
    });
    if probe {
        worker.join().unwrap();
        return;
    }
    let router = Router::new()
        .route(
            "/",
            get(|| async { local_page("index.html", include_str!("../../web/index.html")).await }),
        )
        .route(
            "/demo",
            get(|| async { local_page("demo.html", include_str!("../../web/demo.html")).await }),
        )
        .route(
            "/scene",
            get(|| async { local_page("scene.html", include_str!("../../web/scene.html")).await }),
        )
        .route("/scene.js", get(scene_bundle))
        .route("/dev/build", get(dev_build))
        .route(
            "/status",
            get(|State(app): State<App>| async move { Json(app.snapshot()) }),
        )
        .route("/ws", get(upgrade))
        .with_state(app.clone());
    println!("XREAL WebXR bridge: http://127.0.0.1:4242\nKeep glasses stationary for two seconds to calibrate. Ctrl-C exits and restores the original display mode.");
    let stop = app.commands.clone();
    let stopping = app.stopping.clone();
    axum::serve(listener.unwrap(), router)
        .with_graceful_shutdown(async move {
            tokio::signal::ctrl_c().await.ok();
            stopping.store(true, Ordering::Relaxed);
            let _ = stop.send("stop".into());
        })
        .await
        .unwrap();
    worker.join().ok();
}

async fn local_page(name: &str, fallback: &str) -> Html<String> {
    // Callers use fixed filenames; no user-controlled filesystem paths.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../web")
        .join(name);
    Html(
        tokio::fs::read_to_string(path)
            .await
            .unwrap_or_else(|_| fallback.to_string()),
    )
}

#[derive(Deserialize)]
struct DevQuery {
    loaded: Option<String>,
}
async fn dev_build(State(app): State<App>, Query(query): Query<DevQuery>) -> impl IntoResponse {
    if let Some(loaded) = query
        .loaded
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        let mut state = app.shared.write().unwrap();
        if state.dev_build_seen.as_ref() != Some(&loaded) {
            println!("Extension auto-reload connected: build {}", &loaded[..12]);
            state.dev_build_seen = Some(loaded);
        }
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/dist/build.json");
    match tokio::fs::read(path).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                ("content-type", "application/json"),
                ("cache-control", "no-store"),
            ],
            bytes,
        ),
        Err(_) => (
            StatusCode::NOT_FOUND,
            [
                ("content-type", "application/json"),
                ("cache-control", "no-store"),
            ],
            b"{}".to_vec(),
        ),
    }
}

async fn scene_bundle() -> impl IntoResponse {
    // Fixed project-relative asset path; never accepts a path from the request.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/dist/scene.js");
    match tokio::fs::read(path).await {
        Ok(bytes) => (
            StatusCode::OK,
            [("content-type", "text/javascript; charset=utf-8")],
            bytes,
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [("content-type", "text/plain; charset=utf-8")],
            b"Build the local scene: cd extension && npm ci && npm run build".to_vec(),
        ),
    }
}

fn allowed_origin(origin: &str) -> bool {
    origin == "http://127.0.0.1:4242"
        || origin == "http://localhost:4242"
        || origin
            .strip_prefix("chrome-extension://")
            .is_some_and(|id| id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)))
}
async fn upgrade(
    State(app): State<App>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !allowed_origin(origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.max_message_size(1024)
        .on_upgrade(move |socket| client(socket, app))
        .into_response()
}
async fn client(mut socket: WebSocket, app: App) {
    let mut ticker = tokio::time::interval(Duration::from_millis(11));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _=ticker.tick()=> {
                if app.stopping.load(Ordering::Relaxed) {break;}
                if socket.send(Message::Text(serde_json::to_string(&app.snapshot()).unwrap().into())).await.is_err(){break;}
            }
            msg=socket.recv()=> match msg {
                Some(Ok(Message::Text(text))) if ["recenter","calibrate","stereo","mono"].contains(&text.as_str()) => {
                    let name = text.to_string();
                    let (reply, result) = tokio::sync::oneshot::channel();
                    let outcome = if !app.snapshot().connected {
                        Err(app.snapshot().status)
                    } else if app.commands.send(Command { name: name.clone(), reply: Some(reply) }).is_err() {
                        Err("Sensor worker is not running; restart the helper".to_string())
                    } else {
                        match tokio::time::timeout(Duration::from_secs(3), result).await {
                            Ok(Ok(outcome)) => outcome,
                            _ => Err("No confirmation from glasses; check USB connection".to_string()),
                        }
                    };
                    let response = serde_json::json!({"type":"command_result", "command":name, "ok":outcome.is_ok(), "message":outcome.err()});
                    if socket.send(Message::Text(response.to_string().into())).await.is_err() { break; }
                }
                Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,
                _=>{}
            }
        }
    }
}
// A USB handle cannot survive a device disconnect or re-enumeration. Reopen it
// while keeping HTTP/WebSocket clients alive, and never replay offline commands.
fn supervise(app: &App, rx: &mpsc::Receiver<Command>, probe: bool, mut run: impl FnMut()) {
    loop {
        if app.stopping.load(Ordering::Relaxed) {
            return;
        }
        run();
        if probe || !wait_for_retry(app, rx, Duration::from_secs(1)) {
            return;
        }
    }
}
fn wait_for_retry(app: &App, rx: &mpsc::Receiver<Command>, delay: Duration) -> bool {
    let deadline = Instant::now() + delay;
    while !app.stopping.load(Ordering::Relaxed) {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            return true;
        };
        match rx.recv_timeout(remaining) {
            Ok(command) => {
                if command.name == "stop" {
                    return false;
                }
                if let Some(reply) = command.reply {
                    let _ = reply.send(Err(
                        "Glasses disconnected; waiting for USB reconnection".into()
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => return true,
            Err(mpsc::RecvTimeoutError::Disconnected) => return false,
        }
    }
    false
}
fn sensor_loop(
    app: App,
    rx: &mpsc::Receiver<Command>,
    simulate: bool,
    probe: bool,
    display: &mut DisplayRestore,
) {
    if simulate {
        let start = Instant::now();
        loop {
            let mut stop = false;
            for cmd in rx.try_iter() {
                if cmd.name == "stop" {
                    stop = true;
                }
                if let Some(reply) = cmd.reply {
                    let _ =
                        reply.send(Err("Hardware controls are unavailable in simulation".into()));
                }
            }
            if stop {
                break;
            }
            let t = start.elapsed().as_secs_f32();
            let mut s = app.shared.write().unwrap();
            s.pose = Pose {
                connected: true,
                calibrated: true,
                model: "SIMULATED (no hardware)".into(),
                quaternion: [0., (t * 0.15).sin(), 0., (t * 0.15).cos()],
                sample: s.pose.sample + 1,
                age_ms: 0,
                stereo: false,
                status: "Simulated orientation".into(),
            };
            s.updated = Instant::now();
            drop(s);
            std::thread::sleep(Duration::from_millis(5));
        }
        return;
    }
    let mut glasses = match NrealAir::new() {
        Ok(g) => g,
        Err(e) => {
            let status =
                format!("Waiting for XREAL USB connection — retrying automatically ({e:?})");
            let mut state = app.shared.write().unwrap();
            if state.pose.status != status {
                eprintln!("{status}");
            }
            state.pose.connected = false;
            state.pose.calibrated = false;
            state.pose.status = status;
            return;
        }
    };
    let original = glasses.raw_display_mode().ok();
    if display.original.is_none() {
        display.original = original;
    }
    println!(
        "Connected: {}. Display mode: {:?}",
        glasses.name(),
        original
    );
    let mut f = Fusion::new();
    let start = Instant::now();
    let mut last_report = Instant::now();
    let mut count = 0u64;
    let mut errors = 0;
    {
        let mut s = app.shared.write().unwrap();
        s.pose.connected = true;
        s.pose.model = glasses.name().into();
        s.pose.stereo = matches!(original, Some(3 | 4 | 9));
    }
    'read: loop {
        if app.stopping.load(Ordering::Relaxed) {
            break;
        }
        for cmd in rx.try_iter() {
            // A timed-out caller must not apply an old command after reconnecting.
            if cmd.reply.as_ref().is_some_and(|reply| reply.is_closed()) {
                continue;
            }
            let result = match cmd.name.as_str() {
                "stop" => break 'read,
                "recenter" => {
                    if f.ready {
                        f.recenter();
                        Ok(())
                    } else {
                        Err("Finish stationary calibration before recentering".into())
                    }
                }
                "calibrate" => {
                    f.reset();
                    Ok(())
                }
                "stereo" | "mono" => {
                    let stereo = cmd.name == "stereo";
                    match glasses.set_display_mode(if stereo {
                        DisplayMode::Stereo
                    } else {
                        DisplayMode::SameOnBoth
                    }) {
                        Ok(()) => {
                            display.changed = true;
                            app.shared.write().unwrap().pose.stereo = stereo;
                            Ok(())
                        }
                        Err(e) => Err(format!("Display mode change failed: {e:?}")),
                    }
                }
                _ => Err("Unknown command".into()),
            };
            if let Some(reply) = cmd.reply {
                let _ = reply.send(result);
            }
        }
        match glasses.read_event() {
            Ok(GlassesEvent::AccGyro {
                accelerometer,
                gyroscope,
                timestamp,
            }) => {
                errors = 0;
                count += 1;
                f.update(accelerometer, gyroscope, timestamp);
                let mut s = app.shared.write().unwrap();
                s.pose.quaternion = f.output();
                s.pose.calibrated = f.ready;
                s.pose.sample = count;
                s.updated = Instant::now();
                s.pose.status = if f.ready {
                    "Tracking — recenter while looking forward"
                } else {
                    "Calibration: hold glasses still for two seconds"
                }
                .into();
                if probe && last_report.elapsed() > Duration::from_secs(1) {
                    println!(
                        "samples={count} calibrated={} acceleration={:.3} gyro={:.4} q={:?}",
                        f.ready,
                        accelerometer.norm(),
                        gyroscope.norm(),
                        s.pose.quaternion
                    );
                    last_report = Instant::now();
                }
            }
            Ok(_) => {}
            Err(e) => {
                errors += 1;
                if errors > 12 {
                    eprintln!("Sensor disconnected: {e:?}");
                    break;
                }
            }
        }
        if probe && start.elapsed() > Duration::from_secs(6) {
            break;
        }
    }
    if display.changed && app.stopping.load(Ordering::Relaxed) {
        if let Some(mode) = display.original {
            let _ = glasses.restore_raw_display_mode(mode);
        }
    }
    let mut s = app.shared.write().unwrap();
    s.pose.connected = false;
    s.pose.calibrated = false;
    s.pose.status = if app.stopping.load(Ordering::Relaxed) {
        "Helper stopped"
    } else {
        "Tracking disconnected — reconnecting USB automatically"
    }
    .into();
}
#[cfg(test)]
mod tests {
    use super::*;
    fn test_app() -> (App, mpsc::Receiver<Command>) {
        let (commands, rx) = mpsc::channel();
        (
            App {
                shared: Arc::new(RwLock::new(Shared {
                    pose: initial(),
                    updated: Instant::now(),
                    dev_build_seen: None,
                })),
                commands,
                stopping: Arc::new(AtomicBool::new(false)),
            },
            rx,
        )
    }
    #[test]
    fn supervisor_reopens_after_sensor_session_exits() {
        let (app, rx) = test_app();
        let mut attempts = 0;
        supervise(&app, &rx, false, || {
            attempts += 1;
            if attempts == 2 {
                app.shared.write().unwrap().pose.connected = true;
                app.stopping.store(true, Ordering::Relaxed);
            }
        });
        assert_eq!(attempts, 2);
        assert!(app.snapshot().connected);
    }
    #[test]
    fn offline_commands_fail_and_shutdown_interrupts_retry_wait() {
        let (app, rx) = test_app();
        let (reply, result) = tokio::sync::oneshot::channel();
        app.commands
            .send(Command {
                name: "recenter".into(),
                reply: Some(reply),
            })
            .unwrap();
        app.commands.send("stop".into()).unwrap();
        assert!(!wait_for_retry(&app, &rx, Duration::from_secs(30)));
        assert!(result
            .blocking_recv()
            .unwrap()
            .unwrap_err()
            .contains("disconnected"));
        assert!(
            rx.try_recv().is_err(),
            "offline commands must never replay on reconnect"
        );
    }
    #[test]
    fn probe_does_not_retry_forever_without_hardware() {
        let (app, rx) = test_app();
        let mut attempts = 0;
        supervise(&app, &rx, true, || {
            attempts += 1;
        });
        assert_eq!(attempts, 1);
    }
    #[test]
    fn only_local_ui_and_extensions_can_control_glasses() {
        assert!(allowed_origin(
            "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
        ));
        assert!(allowed_origin("http://127.0.0.1:4242"));
        assert!(!allowed_origin("https://evil.example"));
        assert!(!allowed_origin("chrome-extension://../"));
        assert!(!allowed_origin("null"));
    }
}
