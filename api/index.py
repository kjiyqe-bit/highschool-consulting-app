"""
=============================================================================
고교 수시 상담 관리 웹앱 - Vercel Serverless Function 진입점 (api/index.py)
-----------------------------------------------------------------------------
- Vercel 클라우드 서버리스 환경에서 실행되는 통합 백엔드 핸들러
- Vercel 표준인 `class handler(BaseHTTPRequestHandler)` 규격 준수
- [핵심 개선 1] 구글 스프레드시트 5개 시트 실시간 읽기:
  불안정한 GID 대신 공식 시트명('접근 권한', '학교_기본정보' 등)으로 100% 매칭
- [핵심 개선 2] 상담진 로그인 매칭 완벽화:
  성명/휴대폰번호(숫자만)/사번 공백 및 하이픈 유연 처리
- [핵심 개선 3] Vercel 라우트 3중 감지:
  route 쿼리 파라미터, Vercel 프록시 헤더, self.path 완벽 지원
- HTML/JS 정적 파일 Fallback 내장 (404 원천 차단)
- 구글 드라이브 교과편성표 업로드 및 파일 중복 체크 (Google Apps Script 연동)
- 학교 기본 정보 중복 시 '이력 보존 & 신규 로그 누적' 완벽 지원
=============================================================================
"""

import http.server
import json
import urllib.request
import urllib.parse
import csv
import io
import os
import re
import uuid
import datetime
import tempfile
import base64

# ===========================================================================
# 1. 전역 설정 및 구글 스프레드시트 / 드라이브 정보
# ===========================================================================
SPREADSHEET_ID = "1bCdrA4uBZ2wdiwzj5HU8UIHDaGcKeagZGivASk8qcaY"

# 시트 이름 매핑 (GID 번호 변경에 영향받지 않도록 시트 이름으로 정확히 요청)
SHEET_NAMES = {
    "access": "접근 권한",
    "schools": "학교_기본정보",
    "sushi": "수시합격_입력",
    "programs": "특별프로그램_입력",
    "dashboard": "대시보드_집계용"
}

# 구글 드라이브 교과편성표 전용 폴더 정보
GOOGLE_DRIVE_FOLDER_ID = "1VV99M5R7i0392maHg3qyK5GYodGoNnrf"
GOOGLE_DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1VV99M5R7i0392maHg3qyK5GYodGoNnrf?usp=drive_link"

# 기본 Google Apps Script 웹앱 URL
DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbxG-SFxybt7fjzS0dj77_xojo03iJqn3D5M8Jz3mTxXWKnmJAWdn-qDh5_rWkaDFxub/exec"

# 프로젝트 루트 경로 탐색
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)

# Vercel 서버리스 환경의 임시 쓰기 가능 디렉토리 (/tmp)
TMP_DIR = "/tmp" if os.path.exists("/tmp") else tempfile.gettempdir()
CACHE_FILE = os.path.join(TMP_DIR, "local_cache.json")
CONFIG_FILE = os.path.join(TMP_DIR, "config.json")
UPLOADS_DIR = os.path.join(TMP_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

# 메모리 캐시 객체 (서버리스 인스턴스 생명주기 동안 유지)
MEMORY_CACHE = {
    "data": None,
    "last_fetched": None
}


# ===========================================================================
# 2. 설정 파일(Config) 로드 및 저장 함수
# ===========================================================================
def load_config():
    """Google Apps Script URL 설정을 로드 (/tmp 또는 프로젝트 루트 참조)"""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    root_config = os.path.join(PROJECT_ROOT, "config.json")
    if os.path.exists(root_config):
        try:
            with open(root_config, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    return {"apps_script_url": DEFAULT_GAS_URL}


def save_config(cfg):
    """설정 저장 (/tmp 디렉토리에 안전하게 저장)"""
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[설정 저장 오류] {e}")


# ===========================================================================
# 3. 구글 스프레드시트 원본 데이터 가져오기 (시트명 기반 GViz CSV API)
# ===========================================================================
def fetch_from_google_sheets():
    """
    구글 스프레드시트의 5개 시트에서 최신 데이터를 CSV로 추출하여 JSON 구조로 변환
    - GID 대신 시트 이름(sheet=접근 권한 등)을 사용하여 100% 일치 보장
    """
    data = {
        "access": [],
        "schools": [],
        "sushi": [],
        "programs": [],
        "dashboard": [],
        "last_synced": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    for key, sheet_name in SHEET_NAMES.items():
        encoded_name = urllib.parse.quote(sheet_name)
        url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet={encoded_name}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                csv_text = resp.read().decode("utf-8")
                reader = csv.reader(io.StringIO(csv_text))
                rows = list(reader)

                if not rows or len(rows) < 1:
                    continue

                headers = [h.strip() for h in rows[0]]
                records = []

                for row_idx, r in enumerate(rows[1:]):
                    if not any(r):
                        continue
                    item = {"_id": f"row_{key}_{row_idx + 1}"}
                    for i, h in enumerate(headers):
                        if not h:
                            continue
                        val = r[i].strip() if i < len(r) else ""
                        item[h] = val
                    records.append(item)

                data[key] = records
        except Exception as e:
            print(f"[구글 시트 연동 오류: {key} ({sheet_name})] {e}")

    # 학교_기본정보 시트의 학교코드별 최신 로그 태깅
    schools = data.get("schools", [])
    seen_codes = set()
    for s in schools:
        code = s.get("학교코드(고유값)") or f"{s.get('연도', '')}{s.get('학교명', '')[:4]}"
        if code and code not in seen_codes:
            s["_is_latest"] = True
            seen_codes.add(code)
        else:
            s["_is_latest"] = False

    return data


# ===========================================================================
# 4. 로컬 및 메모리 캐시 초기화
# ===========================================================================
def init_local_data():
    """서버리스 인스턴스 내 메모리 또는 /tmp 캐시에서 데이터를 로드하며, 없으면 구글 시트에서 가져옴"""
    now = datetime.datetime.now()

    # 1. 메모리 캐시가 있고 60초 이내라면 재사용 (고속 응답)
    if MEMORY_CACHE["data"] and MEMORY_CACHE["last_fetched"]:
        elapsed = (now - MEMORY_CACHE["last_fetched"]).total_seconds()
        if elapsed < 60:
            return MEMORY_CACHE["data"]

    # 2. /tmp/local_cache.json 파일 캐시 확인
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                # 접근 권한 데이터가 올바르게 들어있는지 검증
                if saved.get("access") and len(saved.get("access")) > 0:
                    first_row = saved["access"][0]
                    if "이름" in first_row or "휴대폰 번호" in first_row:
                        MEMORY_CACHE["data"] = saved
                        MEMORY_CACHE["last_fetched"] = now
                        return saved
        except Exception:
            pass

    # 3. 구글 시트 원본에서 새로 가져오기
    fresh_data = fetch_from_google_sheets()
    save_local_data(fresh_data)
    MEMORY_CACHE["data"] = fresh_data
    MEMORY_CACHE["last_fetched"] = now
    return fresh_data


def save_local_data(data):
    """데이터를 메모리 및 /tmp 캐시에 동시 저장"""
    MEMORY_CACHE["data"] = data
    MEMORY_CACHE["last_fetched"] = datetime.datetime.now()
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[캐시 파일 저장 실패] {e}")


# ===========================================================================
# 5. Google Apps Script 웹훅 실시간 동기화
# ===========================================================================
def sync_to_google_apps_script(action, table, payload, timeout=15):
    """
    Google Apps Script 웹앱으로 POST 요청을 전송하여 구글 시트 및 드라이브에 실시간 반영
    - action: GAS가 인식하는 값 사용 ("add", "update", "delete", "upload_file", "check_file")
    - 파일 업로드(upload_file)는 timeout을 25초로 늘려서 호출해야 함
    - 실패해도 예외를 던지지 않고 None 반환 (로컬 저장은 보장)
    """
    cfg = load_config()
    gas_url = cfg.get("apps_script_url", "").strip()
    if not gas_url:
        print("[구글 시트 연동 건너뜀] 설정된 Apps Script URL이 없습니다.")
        return None

    try:
        # GAS는 postData.contents를 파싱하며 action, table, data 키를 읽음
        body = json.dumps({
            "action": action,
            "table": table,
            "data": payload,                                # GAS에서 data로 읽음
            "timestamp": datetime.datetime.now().isoformat()
        }).encode("utf-8")

        req = urllib.request.Request(
            gas_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            res_text = resp.read().decode("utf-8")
            print(f"[구글 시트 연동 성공] {action}/{table}: {res_text[:200]}")
            try:
                return json.loads(res_text)
            except Exception:
                return res_text
    except Exception as e:
        print(f"[구글 시트 웹훅 전송 실패] action={action}, table={table}, err={e}")
        return None


def clean_phone(phone_str):
    """휴대폰 번호 비교를 위해 숫자만 추출"""
    return re.sub(r"[^0-9]", "", str(phone_str or ""))


# ===========================================================================
# 6. Vercel Serverless Function 핸들러 클래스 (BaseHTTPRequestHandler)
# ===========================================================================
class handler(http.server.BaseHTTPRequestHandler):
    """Vercel Serverless Function 요청 처리 핸들러"""

    def send_json_response(self, status_code, data):
        """JSON 표준 응답 생성 및 전송"""
        response_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(response_bytes)

    def send_file_response(self, filepath, content_type="text/html; charset=utf-8"):
        """로컬/루트의 정적 파일을 읽어 200 OK로 서빙 (Fallback)"""
        if os.path.exists(filepath) and os.path.isfile(filepath):
            with open(filepath, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
            return True
        return False

    def get_api_route_and_query(self):
        """
        Vercel Rewrites 및 직접 호출 환경에서 API 라우트명을 표준화하여 추출
        반환 예: ('data', query_dict), ('login', query_dict), ('check_file', query_dict)
        """
        parsed_self = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_self.query)

        # 1. vercel.json에서 전달된 route 쿼리 파라미터 확인 (가장 확실함)
        if "route" in query:
            raw_route = query["route"][0].strip()
            # 앞뒤 슬래시 정리
            raw_route = raw_route.strip("/")
            return raw_route, query

        # 2. Vercel 제공 프록시 헤더 확인
        matched = (
            self.headers.get("x-vercel-matched-path") or
            self.headers.get("x-forwarded-uri") or
            self.headers.get("x-matched-path") or
            ""
        )
        if matched:
            parsed_m = urllib.parse.urlparse(matched)
            if not query and parsed_m.query:
                query = urllib.parse.parse_qs(parsed_m.query)
            clean_p = parsed_m.path.replace("/api/", "").strip("/")
            if clean_p and clean_p != "index.py":
                return clean_p, query

        # 3. self.path 자체 확인 (/api/xxx)
        clean_path = parsed_self.path.replace("/api/", "").strip("/")
        if clean_path and clean_path != "index.py":
            return clean_path, query

        # 루트 또는 index.py 자체 호출
        return "", query

    def do_OPTIONS(self):
        """CORS Preflight 요청 처리"""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    # -----------------------------------------------------------------------
    # GET 요청 처리
    # -----------------------------------------------------------------------
    def do_GET(self):
        route, query = self.get_api_route_and_query()

        # ===================================================================
        # [Fallback 정적 서빙] Vercel이 루트(/)나 정적 자원을 본 함수로 보낸 경우
        # ===================================================================
        if route in ["", "index.html"]:
            candidates = [
                os.path.join(PROJECT_ROOT, "index.html"),
                os.path.join(PROJECT_ROOT, "static", "index.html"),
                os.path.join(CURRENT_DIR, "..", "index.html")
            ]
            for c in candidates:
                if self.send_file_response(c, "text/html; charset=utf-8"):
                    return

        if route in ["app.js", "static/app.js"]:
            candidates = [
                os.path.join(PROJECT_ROOT, "app.js"),
                os.path.join(PROJECT_ROOT, "static", "app.js"),
                os.path.join(CURRENT_DIR, "..", "app.js")
            ]
            for c in candidates:
                if self.send_file_response(c, "application/javascript; charset=utf-8"):
                    return

        # ===================================================================
        # 1. 파일 서빙 (/uploads/...)
        # ===================================================================
        if route.startswith("uploads/"):
            filename = urllib.parse.unquote(route.replace("uploads/", ""))
            safe_filename = os.path.basename(filename)
            filepath = os.path.join(UPLOADS_DIR, safe_filename)
            if os.path.exists(filepath) and os.path.isfile(filepath):
                self.send_response(200)
                content_type = "application/pdf" if safe_filename.endswith(".pdf") else "application/octet-stream"
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(os.path.getsize(filepath)))
                self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{urllib.parse.quote(safe_filename)}")
                self.end_headers()
                with open(filepath, "rb") as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_json_response(404, {"error": "파일을 찾을 수 없습니다."})
                return

        # ===================================================================
        # 2. 파일 중복 검사 API (/api/check_file)
        # 속도를 위해 로컬 /tmp 확인만 수행 (GAS 호출 없음 → 빠른 응답)
        # ===================================================================
        if route == "check_file":
            school_code = query.get("school_code", [""])[0].strip()
            raw_filename = query.get("filename", [""])[0].strip()
            ext = query.get("ext", [""])[0].strip()
            if not ext and raw_filename:
                _, fext = os.path.splitext(raw_filename)
                ext = fext or ".pdf"
            if not ext:
                ext = ".pdf"
            if not ext.startswith("."):
                ext = f".{ext}"

            target_filename = f"{school_code}{ext}" if school_code else ""
            exists_local = False
            file_url = ""

            # 로컬 /tmp 폴더에 같은 파일명이 있는지만 확인 (GAS 호출 없이 빠르게)
            if target_filename:
                local_path = os.path.join(UPLOADS_DIR, target_filename)
                exists_local = os.path.exists(local_path)
                if exists_local:
                    host = self.headers.get("Host", "localhost")
                    file_url = f"https://{host}/uploads/{urllib.parse.quote(target_filename)}"

            self.send_json_response(200, {
                "success": True,
                "is_duplicate": exists_local,
                "exists": exists_local,
                "filename": target_filename,
                "existing_url": file_url,
                "google_drive_folder_url": GOOGLE_DRIVE_FOLDER_URL
            })
            return

        # ===================================================================
        # 3. 전체 데이터 조회 API (/api/data)
        # ===================================================================
        if route == "data":
            data = init_local_data()
            config = load_config()
            sanitized_data = {
                "schools": data.get("schools", []),
                "sushi": data.get("sushi", []),
                "programs": data.get("programs", []),
                "dashboard": data.get("dashboard", []),
                "last_synced": data.get("last_synced", ""),
                "google_drive_folder_url": GOOGLE_DRIVE_FOLDER_URL
            }
            self.send_json_response(200, {
                "success": True,
                "data": sanitized_data,
                "config": config
            })
            return

        # ===================================================================
        # 4. 구글 시트 원본 강제 새로고침 API (/api/refresh)
        # ===================================================================
        if route == "refresh":
            new_data = fetch_from_google_sheets()
            save_local_data(new_data)
            self.send_json_response(200, {
                "success": True,
                "data": {
                    "schools": new_data.get("schools", []),
                    "sushi": new_data.get("sushi", []),
                    "programs": new_data.get("programs", []),
                    "dashboard": new_data.get("dashboard", []),
                    "last_synced": new_data.get("last_synced", "")
                }
            })
            return

        # ===================================================================
        # 5. 설정 조회 API (/api/settings)
        # ===================================================================
        if route == "settings":
            config = load_config()
            self.send_json_response(200, {"success": True, "config": config})
            return

        # ===================================================================
        # 6. 기본 헬스 체크 (/api 또는 /api/health)
        # ===================================================================
        if route in ["", "health"]:
            self.send_json_response(200, {
                "status": "healthy",
                "service": "Highschool Consulting App Vercel Serverless Backend",
                "route": route,
                "server_time": datetime.datetime.now().isoformat()
            })
            return

        # 처리되지 않은 경로 404
        self.send_json_response(404, {
            "error": "요청하신 경로를 찾을 수 없습니다.",
            "route": route,
            "raw_path": self.path
        })

    # -----------------------------------------------------------------------
    # POST 요청 처리
    # -----------------------------------------------------------------------
    def do_POST(self):
        route, _ = self.get_api_route_and_query()

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json_response(400, {"error": "유효하지 않은 JSON 데이터입니다."})
            return

        # ===================================================================
        # 1. 로그인 인증 API (/api/login)
        # ===================================================================
        if route == "login":
            name = str(payload.get("name", "")).strip()
            phone = clean_phone(str(payload.get("phone", "")))
            emp_no = str(payload.get("emp_no", "")).strip()

            if not name or not phone or not emp_no:
                self.send_json_response(400, {
                    "success": False,
                    "error": "성명, 휴대폰 번호, 사번을 모두 입력해 주세요."
                })
                return

            # 구글 시트에서 최신 접근 권한 데이터 확인
            data = init_local_data()
            access_list = data.get("access", [])

            # 매칭 비교 (공백 제거 등 유연한 비교 적용)
            clean_input_name = name.replace(" ", "")
            clean_input_emp = emp_no.replace(" ", "")

            matched_user = None
            for row in access_list:
                row_name = str(row.get("이름", "")).strip()
                row_phone = clean_phone(str(row.get("휴대폰 번호", "")))
                row_emp_no = str(row.get("사번", "")).strip()

                name_match = (row_name == name) or (row_name.replace(" ", "") == clean_input_name)
                phone_match = (row_phone == phone)
                emp_match = (row_emp_no == emp_no) or (row_emp_no.replace(" ", "") == clean_input_emp)

                if name_match and phone_match and emp_match:
                    # 구글 시트 '접근 권한' 시트 D열 헤더("관리자" 또는 "권한") 및 셀 값 검사
                    raw_auth = str(row.get("관리자") or row.get("권한") or "").strip()
                    if not raw_auth:
                        # 컬럼명이 다른 경우를 대비해 행의 모든 값 중 "관리자" 문자열 검색
                        for k, v in row.items():
                            if k != "_id" and "관리자" in str(v):
                                raw_auth = "관리자"
                                break

                    role = "admin" if ("관리자" in raw_auth or "admin" in raw_auth.lower()) else "user"
                    matched_user = {
                        "name": row_name,
                        "phone": row_phone,
                        "emp_no": row_emp_no,
                        "role": role,
                        "role_label": "관리자" if role == "admin" else "일반 사용자"
                    }
                    break

            if matched_user:
                self.send_json_response(200, {
                    "success": True,
                    "message": "인증에 성공하였습니다.",
                    "user": matched_user
                })
            else:
                self.send_json_response(401, {
                    "success": False,
                    "error": "입력하신 정보와 일치하는 계정을 찾을 수 없습니다. (이름, 휴대폰번호, 사번을 확인하세요)"
                })
            return

        # ===================================================================
        # 2. 교과 편성표 파일 업로드 API (/api/upload)
        # ===================================================================
        if route == "upload":
            raw_filename = payload.get("filename", "")
            school_code = payload.get("school_code", "").strip()
            file_base64 = payload.get("file_base64", "")
            overwrite = payload.get("overwrite", False)

            if not file_base64 or not raw_filename:
                self.send_json_response(400, {"success": False, "error": "업로드할 파일 데이터가 없습니다."})
                return

            _, ext = os.path.splitext(raw_filename)
            if not ext:
                ext = ".pdf"

            target_filename = f"{school_code}{ext}" if school_code else f"curriculum_{uuid.uuid4().hex[:8]}{ext}"

            # /tmp 디렉토리에 임시 파일 저장 (Vercel 서버리스 환경)
            local_filepath = os.path.join(UPLOADS_DIR, target_filename)
            file_bytes = base64.b64decode(file_base64)
            with open(local_filepath, "wb") as f:
                f.write(file_bytes)

            host = self.headers.get("Host", "localhost")
            final_file_url = f"https://{host}/uploads/{urllib.parse.quote(target_filename)}"
            drive_status = "pending"

            # Google Apps Script를 통해 구글 드라이브 폴더에 업로드
            # 타임아웃을 25초로 늘림 (파일 전송은 오래 걸릴 수 있음)
            # GAS 업로드 실패해도 로컬 저장은 성공 → 전체 실패 처리하지 않음
            try:
                gas_res = sync_to_google_apps_script("upload_file", "schools", {
                    "file_name": target_filename,
                    "file_base64": file_base64,
                    "folder_id": GOOGLE_DRIVE_FOLDER_ID,
                    "overwrite": overwrite,
                    "mime_type": "application/pdf" if ext.lower() == ".pdf" else "application/octet-stream"
                }, timeout=25)

                if gas_res and isinstance(gas_res, dict) and gas_res.get("file_url"):
                    final_file_url = gas_res["file_url"]
                    drive_status = "success"
                else:
                    drive_status = "fallback_local"
                    print(f"[드라이브 업로드 실패 - 로컬 저장으로 대체] {target_filename}")
            except Exception as e:
                drive_status = "error"
                print(f"[드라이브 업로드 오류] {e}")

            self.send_json_response(200, {
                "success": True,
                "url": final_file_url,
                "filename": target_filename,
                "drive_status": drive_status,
                "is_drive_uploaded": drive_status == "success",
                "google_drive_folder_url": GOOGLE_DRIVE_FOLDER_URL
            })
            return

        # ===================================================================
        # 3. 학교 기본 정보 등록 API (/api/schools)
        # ===================================================================
        if route == "schools":
            year = str(payload.get("연도", "2026")).strip()
            name = str(payload.get("학교명", "")).strip()
            students = str(payload.get("전교 학생수", "")).strip()
            curriculum_link = str(payload.get("교과 편성표(링크)", "")).strip() or "링크입력예정"
            is_update_log = payload.get("is_update_log", False)

            if not name:
                self.send_json_response(400, {"success": False, "error": "학교명을 입력해 주세요."})
                return

            prefix = name[:4] if len(name) >= 4 else name
            school_code = f"{year}{prefix}"

            data = init_local_data()
            schools = data.get("schools", [])

            # 동일 학교코드가 존재하고 수정(is_update_log)인 경우: 기존 로그는 보존(_is_latest=False)
            if is_update_log:
                for row in schools:
                    row_code = row.get("학교코드(고유값)") or f"{row.get('연도', '')}{row.get('학교명', '')[:4]}"
                    if row_code == school_code:
                        row["_is_latest"] = False

            new_row = {
                "_id": f"school_{uuid.uuid4().hex[:8]}",
                "학교코드(고유값)": school_code,
                "연도": year,
                "학교명": name,
                "전교 학생수": students,
                "교과 편성표(링크)": curriculum_link,
                "데이터 수집 현황": "0 / 10",
                "등록일시": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "_is_latest": True
            }

            # 최신 로그가 맨 위에 오도록 배열의 시작(0번 인덱스)에 추가
            schools.insert(0, new_row)
            data["schools"] = schools
            save_local_data(data)

            # 구글 시트에 실시간 반영 (GAS action 이름: "add")
            sync_to_google_apps_script("add", "schools", new_row)

            self.send_json_response(201, {"success": True, "item": new_row})
            return

        # ===================================================================
        # 4. 수시 합격 데이터 등록 API (/api/sushi)
        # ===================================================================
        if route == "sushi":
            year = payload.get("연도", 2026)
            school = str(payload.get("학교명", "")).strip()
            rank = str(payload.get("전교 등수", "")).strip()
            grade = payload.get("내신 등급", "")
            univ = str(payload.get("합격 대학", "")).strip()
            dept = str(payload.get("합격 학과", "")).strip()
            s_type = str(payload.get("전형명", "")).strip()
            author = str(payload.get("입력자", "")).strip()

            if not school or not univ or not dept:
                self.send_json_response(400, {"success": False, "error": "학교명, 합격 대학, 합격 학과는 필수 입력입니다."})
                return

            data = init_local_data()
            new_row = {
                "_id": f"sushi_{uuid.uuid4().hex[:8]}",
                "입력일시": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "연도": year,
                "학교명": school,
                "전교 등수": rank,
                "내신 등급": grade,
                "합격 대학": univ,
                "합격 학과": dept,
                "전형명": s_type,
                "입력자": author
            }
            data["sushi"].insert(0, new_row)
            save_local_data(data)

            sync_to_google_apps_script("add", "sushi", new_row)
            self.send_json_response(201, {"success": True, "item": new_row})
            return

        # ===================================================================
        # 5. 특별 프로그램 등록 API (/api/programs)
        # ===================================================================
        if route == "programs":
            year = payload.get("연도", 2026)
            school = str(payload.get("학교명", "")).strip()
            title = str(payload.get("프로그램 명칭", "")).strip()
            desc = str(payload.get("프로그램 주요 내용", "")).strip()
            author = str(payload.get("입력자", "")).strip()

            if not school or not title:
                self.send_json_response(400, {"success": False, "error": "학교명과 프로그램 명칭은 필수 입력입니다."})
                return

            data = init_local_data()
            new_row = {
                "_id": f"prog_{uuid.uuid4().hex[:8]}",
                "입력일시": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "연도": year,
                "학교명": school,
                "프로그램 명칭": title,
                "프로그램 주요 내용": desc,
                "입력자": author
            }
            data["programs"].insert(0, new_row)
            save_local_data(data)

            sync_to_google_apps_script("add", "programs", new_row)
            self.send_json_response(201, {"success": True, "item": new_row})
            return

        # ===================================================================
        # 6. 설정 저장 API (/api/settings)
        # ===================================================================
        if route == "settings":
            new_gas_url = payload.get("apps_script_url", "").strip()
            role = payload.get("user_role", "")
            if role != "admin":
                self.send_json_response(403, {"success": False, "error": "관리자만 설정을 변경할 수 있습니다."})
                return

            cfg = load_config()
            cfg["apps_script_url"] = new_gas_url
            save_config(cfg)
            self.send_json_response(200, {"success": True, "message": "설정이 저장되었습니다."})
            return

        self.send_json_response(404, {"error": "요청하신 경로를 찾을 수 없습니다.", "route": route})

    # -----------------------------------------------------------------------
    # PUT 요청 처리 (수정)
    # -----------------------------------------------------------------------
    def do_PUT(self):
        route, _ = self.get_api_route_and_query()

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json_response(400, {"error": "유효하지 않은 JSON 데이터입니다."})
            return

        item_id = payload.get("_id")
        if not item_id:
            self.send_json_response(400, {"error": "수정할 항목의 _id가 누락되었습니다."})
            return

        data = init_local_data()
        table_key = "schools" if route == "schools" else "sushi" if route == "sushi" else "programs" if route == "programs" else None

        if not table_key:
            self.send_json_response(404, {"error": "지원하지 않는 수정 엔드포인트입니다."})
            return

        updated_item = None
        for item in data.get(table_key, []):
            if item.get("_id") == item_id:
                item.update(payload)
                updated_item = item
                break

        if updated_item:
            save_local_data(data)
            sync_to_google_apps_script("update", table_key, updated_item)
            self.send_json_response(200, {"success": True, "item": updated_item})
        else:
            self.send_json_response(404, {"error": "수정할 항목을 찾을 수 없습니다."})

    # -----------------------------------------------------------------------
    # DELETE 요청 처리 (삭제)
    # -----------------------------------------------------------------------
    def do_DELETE(self):
        route, query = self.get_api_route_and_query()

        item_id = query.get("id", [""])[0]
        if not item_id:
            self.send_json_response(400, {"error": "삭제할 항목의 id가 누락되었습니다."})
            return

        data = init_local_data()
        table_key = "schools" if route == "schools" else "sushi" if route == "sushi" else "programs" if route == "programs" else None

        if not table_key:
            self.send_json_response(404, {"error": "지원하지 않는 삭제 엔드포인트입니다."})
            return

        original_len = len(data.get(table_key, []))
        data[table_key] = [item for item in data.get(table_key, []) if item.get("_id") != item_id]

        if len(data[table_key]) < original_len:
            save_local_data(data)
            sync_to_google_apps_script("delete", table_key, {"_id": item_id})
            self.send_json_response(200, {"success": True, "message": "삭제 완료"})
        else:
            self.send_json_response(404, {"error": "삭제할 항목을 찾을 수 없습니다."})
