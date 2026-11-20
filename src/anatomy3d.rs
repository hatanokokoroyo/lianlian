//! 3D 解剖 spike 的本地资源服务。
//!
//! Android WebView 不能直接读仓库里的文件，也不会给 `file://` 下的 Draco worker
//! 正常权限；这里用 std 起一个只绑 `127.0.0.1` 的 HTTP 服务，把 viewer 需要的
//! 文件用 `include_bytes!` 编进二进制。服务只在首次调用时启动一次，线程随进程
//! 结束，不做清理。

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

const PAGE_PATH: &str = "/design/prototypes/anatomy-3d/";
const PAGE_URL: &str = "/design/prototypes/anatomy-3d/?tier=cap3000&view=front";
const INDEX_PATH: &str = "/design/prototypes/anatomy-3d/index.html";

const HTML: &str = "text/html; charset=utf-8";
const CSS: &str = "text/css; charset=utf-8";
const JS: &str = "text/javascript; charset=utf-8";
const JSON: &str = "application/json; charset=utf-8";
const WASM: &str = "application/wasm";
const GLB: &str = "model/gltf-binary";
const TEXT: &str = "text/plain; charset=utf-8";

struct Asset {
    path: &'static str,
    content_type: &'static str,
    bytes: &'static [u8],
}

/// 路由与仓库路径一致；viewer 里的相对路径和绝对路径都能命中。
const ASSETS: &[Asset] = &[
    Asset {
        path: INDEX_PATH,
        content_type: HTML,
        bytes: include_bytes!("../design/prototypes/anatomy-3d/index.html"),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/style.css",
        content_type: CSS,
        bytes: include_bytes!("../design/prototypes/anatomy-3d/style.css"),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/viewer.js",
        content_type: JS,
        bytes: include_bytes!("../design/prototypes/anatomy-3d/viewer.js"),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/three/three.module.js",
        content_type: JS,
        bytes: include_bytes!("../design/prototypes/anatomy-3d/vendor/three/three.module.js"),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/three/three.core.js",
        content_type: JS,
        bytes: include_bytes!("../design/prototypes/anatomy-3d/vendor/three/three.core.js"),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/three/addons/controls/OrbitControls.js",
        content_type: JS,
        bytes: include_bytes!(
            "../design/prototypes/anatomy-3d/vendor/three/addons/controls/OrbitControls.js"
        ),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/three/addons/loaders/GLTFLoader.js",
        content_type: JS,
        bytes: include_bytes!(
            "../design/prototypes/anatomy-3d/vendor/three/addons/loaders/GLTFLoader.js"
        ),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/three/addons/loaders/DRACOLoader.js",
        content_type: JS,
        bytes: include_bytes!(
            "../design/prototypes/anatomy-3d/vendor/three/addons/loaders/DRACOLoader.js"
        ),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/three/addons/utils/BufferGeometryUtils.js",
        content_type: JS,
        bytes: include_bytes!(
            "../design/prototypes/anatomy-3d/vendor/three/addons/utils/BufferGeometryUtils.js"
        ),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/draco/draco_decoder.js",
        content_type: JS,
        bytes: include_bytes!("../design/prototypes/anatomy-3d/vendor/draco/draco_decoder.js"),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/draco/draco_decoder.wasm",
        content_type: WASM,
        bytes: include_bytes!("../design/prototypes/anatomy-3d/vendor/draco/draco_decoder.wasm"),
    },
    Asset {
        path: "/design/prototypes/anatomy-3d/vendor/draco/draco_wasm_wrapper.js",
        content_type: JS,
        bytes: include_bytes!("../design/prototypes/anatomy-3d/vendor/draco/draco_wasm_wrapper.js"),
    },
    Asset {
        path: "/scripts/anatomy/za-export.json",
        content_type: JSON,
        bytes: include_bytes!("../scripts/anatomy/za-export.json"),
    },
    Asset {
        path: "/docs/research/assets/za-raw-smooth.glb",
        content_type: GLB,
        bytes: include_bytes!("../docs/research/assets/za-raw-smooth.glb"),
    },
    Asset {
        path: "/docs/research/assets/za-cap3000-smooth.glb",
        content_type: GLB,
        bytes: include_bytes!("../docs/research/assets/za-cap3000-smooth.glb"),
    },
];

static BASE_URL: OnceLock<Option<String>> = OnceLock::new();

/// 启动一次本地服务并返回 `http://127.0.0.1:PORT`；绑定失败时是 `None`。
fn base_url() -> Option<&'static str> {
    BASE_URL
        .get_or_init(|| {
            let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
            let port = listener.local_addr().ok()?.port();
            thread::spawn(move || {
                for stream in listener.incoming() {
                    match stream {
                        Ok(stream) => {
                            thread::spawn(move || serve(stream));
                        }
                        Err(_) => continue,
                    }
                }
            });
            Some(format!("http://127.0.0.1:{port}"))
        })
        .as_deref()
}

/// viewer 页面地址；默认走性能档，模拟器优先。
pub fn viewer_url() -> String {
    match base_url() {
        Some(base) => format!("{base}{PAGE_URL}"),
        None => String::new(),
    }
}

enum Body {
    Static(&'static [u8]),
    Owned(Vec<u8>),
}

impl Body {
    fn bytes(&self) -> &[u8] {
        match self {
            Body::Static(bytes) => bytes,
            Body::Owned(bytes) => bytes,
        }
    }
}

struct Response {
    status: u16,
    content_type: &'static str,
    body: Body,
}

impl Response {
    fn asset(asset: &'static Asset) -> Self {
        Self {
            status: 200,
            content_type: asset.content_type,
            body: Body::Static(asset.bytes),
        }
    }

    fn text(status: u16, message: &str) -> Self {
        Self {
            status,
            content_type: TEXT,
            body: Body::Owned(message.as_bytes().to_vec()),
        }
    }
}

fn health() -> Response {
    let mut assets = Vec::with_capacity(ASSETS.len());
    let mut total = 0_u64;
    for asset in ASSETS {
        let len = asset.bytes.len() as u64;
        total += len;
        // 路径都是本模块里的静态 ASCII，不含需要转义的字符。
        assets.push(format!("\"{}\":{}", asset.path, len));
    }
    let body = format!(
        "{{\"ok\":true,\"page\":\"{}\",\"total_bytes\":{},\"assets\":{{{}}}}}",
        PAGE_PATH,
        total,
        assets.join(",")
    );
    Response {
        status: 200,
        content_type: JSON,
        body: Body::Owned(body.into_bytes()),
    }
}

/// 纯路由：测试直接调它，不碰 socket。
fn route(method: &str, target: &str) -> Response {
    if method != "GET" {
        return Response::text(405, "method not allowed\n");
    }
    let path = target.split('?').next().unwrap_or(target);
    let path = match path {
        "/design/prototypes/anatomy-3d" | "/design/prototypes/anatomy-3d/" => INDEX_PATH,
        other => other,
    };
    if path == "/__health" {
        return health();
    }
    match ASSETS.iter().find(|asset| asset.path == path) {
        Some(asset) => Response::asset(asset),
        None => Response::text(404, "not found\n"),
    }
}

fn serve(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));

    let mut reader = match stream.try_clone() {
        Ok(stream) => BufReader::new(stream),
        Err(_) => return,
    };
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return;
    }
    // 读掉请求头，避免客户端还在发数据时就回包导致连接被重置。
    loop {
        let mut header = String::new();
        match reader.read_line(&mut header) {
            Ok(0) => break,
            Ok(_) if header == "\r\n" || header == "\n" => break,
            Ok(_) => {}
            Err(_) => return,
        }
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let response = route(method, target);
    let body = response.body.bytes();
    let reason = match response.status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        response.status,
        reason,
        response.content_type,
        body.len()
    );
    if stream.write_all(head.as_bytes()).is_err() {
        return;
    }
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(path: &str) -> &'static Asset {
        ASSETS
            .iter()
            .find(|asset| asset.path == path)
            .expect("asset is embedded")
    }

    #[test]
    fn page_route_serves_index_for_directory_and_file() {
        for path in [
            "/design/prototypes/anatomy-3d/",
            "/design/prototypes/anatomy-3d/index.html",
            "/design/prototypes/anatomy-3d/?tier=cap3000&view=back",
        ] {
            let response = route("GET", path);
            assert_eq!(response.status, 200, "{path}");
            assert_eq!(response.content_type, HTML, "{path}");
            assert!(
                response.body.bytes().starts_with(b"<!doctype html>"),
                "{path}"
            );
        }
    }

    #[test]
    fn mime_types_match_the_asset_kind() {
        let cases = [
            ("/design/prototypes/anatomy-3d/style.css", CSS),
            ("/design/prototypes/anatomy-3d/viewer.js", JS),
            (
                "/design/prototypes/anatomy-3d/vendor/draco/draco_decoder.wasm",
                WASM,
            ),
            ("/scripts/anatomy/za-export.json", JSON),
            ("/docs/research/assets/za-cap3000-smooth.glb", GLB),
            ("/docs/research/assets/za-raw-smooth.glb", GLB),
        ];
        for (path, content_type) in cases {
            let response = route("GET", path);
            assert_eq!(response.status, 200, "{path}");
            assert_eq!(response.content_type, content_type, "{path}");
            assert_eq!(
                response.body.bytes().len(),
                asset(path).bytes.len(),
                "{path}"
            );
        }
    }

    #[test]
    fn unknown_paths_are_404_and_non_get_is_405() {
        let missing = route("GET", "/design/prototypes/anatomy-3d/missing.js");
        assert_eq!(missing.status, 404);
        assert_eq!(missing.content_type, TEXT);

        let post = route("POST", PAGE_PATH);
        assert_eq!(post.status, 405);
        assert_eq!(post.content_type, TEXT);
    }

    #[test]
    fn health_reports_every_asset_size() {
        let response = route("GET", "/__health");
        assert_eq!(response.status, 200);
        assert_eq!(response.content_type, JSON);
        let json: serde_json::Value =
            serde_json::from_slice(response.body.bytes()).expect("health is JSON");
        assert_eq!(json["assets"].as_object().unwrap().len(), ASSETS.len());
        let total: u64 = ASSETS.iter().map(|asset| asset.bytes.len() as u64).sum();
        assert_eq!(json["total_bytes"].as_u64(), Some(total));
    }

    #[test]
    fn viewer_url_defaults_to_the_performance_tier() {
        if let Some(base) = base_url() {
            assert!(base.starts_with("http://127.0.0.1:"));
            assert_eq!(
                viewer_url(),
                format!("{base}/design/prototypes/anatomy-3d/?tier=cap3000&view=front")
            );
        }
    }

    /// 手跑：`cargo test curl_smoke -- --ignored --nocapture`
    /// 需要本机有 curl；默认测试不依赖外部命令。
    #[test]
    #[ignore]
    fn curl_smoke() {
        use std::process::Command;

        let base = base_url().expect("loopback server starts");
        let cases = [
            ("/__health", JSON),
            (PAGE_PATH, HTML),
            ("/design/prototypes/anatomy-3d/viewer.js", JS),
            ("/scripts/anatomy/za-export.json", JSON),
            ("/docs/research/assets/za-cap3000-smooth.glb", GLB),
            ("/docs/research/assets/za-raw-smooth.glb", GLB),
        ];
        for (path, content_type) in cases {
            let output = Command::new("curl")
                .args([
                    "-sS",
                    "-o",
                    "/dev/null",
                    "-w",
                    "%{http_code}|%{size_download}|%{content_type}",
                ])
                .arg(format!("{base}{path}"))
                .output()
                .expect("curl runs");
            assert!(output.status.success(), "curl failed for {path}");
            let line = String::from_utf8_lossy(&output.stdout);
            println!("{path} -> {line}");
            let fields: Vec<&str> = line.split('|').collect();
            assert_eq!(fields[0], "200", "{path}");
            if path != "/__health" {
                let expected_path = if path == PAGE_PATH { INDEX_PATH } else { path };
                assert_eq!(
                    fields[1].parse::<usize>().unwrap(),
                    asset(expected_path).bytes.len(),
                    "{path}"
                );
            }
            assert_eq!(fields[2], content_type, "{path}");
        }
    }
}
