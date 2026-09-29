/**
 * ====================================================================
 * 고교 수시 상담 관리 웹앱 프론트엔드 비즈니스 로직 (app.js v4)
 * --------------------------------------------------------------------
 * 1. 탭 명칭 통일:
 *    - 학교 기본 정보 입력 / 수시 합격 입력 / 특별 프로그램 입력 / 학교별 정보 대시 보드
 * 2. 교과 편성표 구글 드라이브 파일 업로드 & 중복 검사:
 *    - 학교 고유번호(학교코드)로 파일명 생성
 *    - 기존 중복 파일 검사 후 "삭제 후 업로드 / 아니오" 컨펌 대화창 제공
 * 3. 학교 정보 중복 입력 시 "이력 보존 & 신규 로그 누적":
 *    - 동일 학교코드 입력 시 "수정 / 아니오" 컨펌 대화창 제공
 *    - [수정] 시 DB에 기존 로그는 보존하고 최신 내용으로 새 로그 누적 반영
 *    - 대시보드는 항상 최신 로그 기준으로 표출
 *    - 등록 목록에서 "과거 이력 로그도 모두 표시" 토글 필터 제공
 * ====================================================================
 */

// 애플리케이션 전역 상태 객체
const state = {
  user: null,                  // 로그인 사용자 객체 { name, phone, emp_no, role, role_label }
  currentTab: 'tab-school-info', // 활성화된 탭
  viewMode: 'deck',            // 대시보드 뷰: 'deck' 또는 'table'
  curriculumMode: 'file',      // 편성표 모드: 'file' 또는 'url'
  selectedFile: null,          // 업로드 선택 파일
  uploadedFileUrl: '',         // 업로드 완료 URL
  schools: [],                 // '학교_기본정보' 데이터
  sushi: [],                   // '수시합격_입력' 데이터
  programs: [],                // '특별프로그램_입력' 데이터
  dashboard: [],               // '대시보드_집계용' 데이터
  config: { apps_script_url: '' },
  selectedSchool: null,
  pendingFileOverwriteResolver: null, // 구글 드라이브 파일 중복 확인 모달 대기 프라미스 리졸버
  pendingSchoolDuplicateResolver: null // 학교 정보 중복 확인 모달 대기 프라미스 리졸버
};

// ====================================================================
// 1. 초기화 및 세션 / 오늘 날짜 설정
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // 1. 사번 입력 칸 placeholder에 '오늘 날짜' 동적 주입 (요구사항 반영)
  setTodayPlaceholderForEmpNo();

  // 2. 세션 복원
  const savedUser = sessionStorage.getItem('consulting_user');
  if (savedUser) {
    try {
      state.user = JSON.parse(savedUser);
      applyUserSession();
    } catch (e) {
      sessionStorage.removeItem('consulting_user');
    }
  }

  // 3. 기본 탭 활성화: '학교 기본 정보 입력'
  switchTab(state.currentTab);

  // 4. 학교코드 미리보기 초기화
  updateGeneratedCodePreview();

  // 5. 서버 데이터 로딩
  loadData();
});

/**
 * 사번 칸의 placeholder에 오늘 날짜(YYYY-MM-DD)를 자동 표시
 */
function setTodayPlaceholderForEmpNo() {
  const empInput = document.getElementById('login-emp-no');
  if (empInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    empInput.placeholder = `${yyyy}-${mm}-${dd}`;
  }
}

/**
 * 로그인 세션 적용
 */
function applyUserSession() {
  const overlay = document.getElementById('login-overlay');
  if (state.user) {
    if (overlay) overlay.classList.add('hidden');

    document.getElementById('user-name-display').textContent = state.user.name;
    document.getElementById('user-avatar').textContent = state.user.name.charAt(0);
    document.getElementById('user-emp-display').textContent = `사번: ${state.user.emp_no}`;
    
    const roleBadge = document.getElementById('user-role-badge');
    const mobUserBadge = document.getElementById('mob-user-badge');
    if (roleBadge) {
      roleBadge.textContent = state.user.role_label;
      if (state.user.role === 'admin') {
        roleBadge.className = 'text-[9px] px-1.5 py-0.2 rounded font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
      } else {
        roleBadge.className = 'text-[9px] px-1.5 py-0.2 rounded font-bold bg-slate-700 text-slate-300';
      }
    }
    if (mobUserBadge) mobUserBadge.textContent = state.user.name;

    const adminSettingsBtn = document.getElementById('admin-settings-btn');
    if (adminSettingsBtn) {
      if (state.user.role === 'admin') {
        adminSettingsBtn.classList.remove('hidden');
      } else {
        adminSettingsBtn.classList.add('hidden');
      }
    }

    const sushiAuthor = document.getElementById('sushi-author');
    const progAuthor = document.getElementById('prog-author');
    if (sushiAuthor && !sushiAuthor.value) sushiAuthor.value = state.user.name;
    if (progAuthor && !progAuthor.value) progAuthor.value = state.user.name;

  } else {
    if (overlay) overlay.classList.remove('hidden');
  }
}

/**
 * 로그인 폼 제출
 */
async function handleLoginSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById('login-submit-btn');
  const errorBox = document.getElementById('login-error-msg');
  const errorText = document.getElementById('login-error-text');

  btn.disabled = true;
  btn.innerHTML = `<span class="animate-pulse">인증 확인 중...</span>`;
  errorBox.classList.add('hidden');

  const payload = {
    name: document.getElementById('login-name').value.trim(),
    phone: document.getElementById('login-phone').value.trim(),
    emp_no: document.getElementById('login-emp-no').value.trim()
  };

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result.success && result.user) {
      state.user = result.user;
      sessionStorage.setItem('consulting_user', JSON.stringify(result.user));
      applyUserSession();
      showToast(`${state.user.name}님 환영합니다! (${state.user.role_label})`, 'success');
      await loadData();
    } else {
      errorText.textContent = result.error || '접근 권한이 없습니다. 정보를 다시 확인해 주세요.';
      errorBox.classList.remove('hidden');
    }
  } catch (err) {
    errorText.textContent = '서버 통신 중 오류가 발생했습니다.';
    errorBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>인증 및 시스템 접속</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
    lucide.createIcons();
  }
}

function handleLogout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  state.user = null;
  sessionStorage.removeItem('consulting_user');
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.remove('hidden');
  showToast('로그아웃 되었습니다.', 'info');
}

// ====================================================================
// 2. 서버 데이터 페치 및 동기화
// ====================================================================
async function loadData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('데이터 응답 실패');

    const result = await res.json();
    if (result.success) {
      state.schools = result.data.schools || [];
      state.sushi = result.data.sushi || [];
      state.programs = result.data.programs || [];
      state.dashboard = result.data.dashboard || [];
      state.config = result.config || { apps_script_url: '' };

      const syncTimeEl = document.getElementById('last-sync-time');
      if (syncTimeEl) {
        syncTimeEl.textContent = result.data.last_synced ? `최근 동기화: ${result.data.last_synced}` : '방금 동기화됨';
      }

      populateSchoolDatalist();
      updateStatistics();
      renderCurrentTab();
    }
  } catch (error) {
    console.error('데이터 로딩 오류:', error);
  }
}

async function refreshData() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('animate-spin');

  try {
    const res = await fetch('/api/refresh');
    const result = await res.json();
    if (result.success) {
      state.schools = result.data.schools || [];
      state.sushi = result.data.sushi || [];
      state.programs = result.data.programs || [];
      state.dashboard = result.data.dashboard || [];

      const syncTimeEl = document.getElementById('last-sync-time');
      if (syncTimeEl) syncTimeEl.textContent = `최근 동기화: ${result.data.last_synced}`;

      populateSchoolDatalist();
      updateStatistics();
      renderCurrentTab();
      showToast('구글 스프레드시트 5개 시트가 최신으로 동기화되었습니다.', 'success');
    }
  } catch (e) {
    showToast('새로고침 중 오류가 발생했습니다.', 'error');
  } finally {
    if (icon) icon.classList.remove('animate-spin');
  }
}

// ====================================================================
// 3. 네비게이션 탭 전환 (명칭: '학교 기본 정보 입력')
// ====================================================================
function switchTab(tabId) {
  state.currentTab = tabId;

  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  
  const activeNav = document.getElementById(`nav-${tabId}`);
  if (activeNav) activeNav.classList.add('active');

  document.querySelectorAll('[id^="mob-"]').forEach(el => el.classList.remove('text-blue-600', 'font-bold'));
  const mobNav = document.getElementById(`mob-${tabId}`);
  if (mobNav) mobNav.classList.add('text-blue-600', 'font-bold');

  const targetContent = document.getElementById(tabId);
  if (targetContent) targetContent.classList.remove('hidden');

  const titleEl = document.getElementById('page-title');
  const descEl = document.getElementById('page-desc');

  if (tabId === 'tab-school-info') {
    titleEl.textContent = '학교 기본 정보 입력';
    descEl.textContent = "'학교_기본정보' 시트에 신규 학교 데이터를 등록하고 교과 편성표 파일을 구글 드라이브 폴더와 연계합니다.";
  } else if (tabId === 'tab-sushi') {
    titleEl.textContent = '수시합격 입력';
    descEl.textContent = "최상위권 학생들의 수시 합격 사례를 신규 등록하거나 기존 내역을 수정·삭제합니다.";
  } else if (tabId === 'tab-programs') {
    titleEl.textContent = '특별프로그램 입력';
    descEl.textContent = "학교별 특색 비교과 프로그램, 캠프, 동아리 활동을 등록하고 관리합니다.";
  } else if (tabId === 'tab-dashboard') {
    titleEl.textContent = '학교별 상담 대시보드';
    descEl.textContent = "인근 고등학교의 수시 합격 데이터와 특별 프로그램을 실시간으로 조회하고 상담에 활용하세요.";
  }

  renderCurrentTab();
  lucide.createIcons();
}

function renderCurrentTab() {
  if (state.currentTab === 'tab-school-info') {
    renderSchoolsTable();
  } else if (state.currentTab === 'tab-sushi') {
    renderSushiTable();
  } else if (state.currentTab === 'tab-programs') {
    renderProgTable();
  } else if (state.currentTab === 'tab-dashboard') {
    renderDashboard();
  }
}

function populateSchoolDatalist() {
  const datalistSushi = document.getElementById('school-datalist');
  const datalistProg = document.getElementById('school-datalist-prog');
  const names = Array.from(new Set(state.schools.map(s => s['학교명']).filter(Boolean)));
  if (names.length === 0) names.push('A고등학교');

  const optionsHtml = names.map(n => `<option value="${n}">`).join('');
  if (datalistSushi) datalistSushi.innerHTML = optionsHtml;
  if (datalistProg) datalistProg.innerHTML = optionsHtml;
}

function updateStatistics() {
  const sEl = document.getElementById('stat-total-schools');
  const suEl = document.getElementById('stat-total-sushi');
  const pEl = document.getElementById('stat-total-progs');

  if (sEl) sEl.textContent = `${state.schools.length}개교`;
  if (suEl) suEl.textContent = `${state.sushi.length}건`;
  if (pEl) pEl.textContent = `${state.programs.length}건`;

  const scBadge = document.getElementById('schools-count-badge');
  if (scBadge) scBadge.textContent = `${state.schools.length}개교`;

  const suBadge = document.getElementById('sushi-count-badge');
  if (suBadge) suBadge.textContent = `${state.sushi.length}건`;

  const prBadge = document.getElementById('prog-count-badge');
  if (prBadge) prBadge.textContent = `${state.programs.length}건`;
}

// ====================================================================
// 4. [입력 탭 1] 학교 기본 정보 입력
//    (학교 고유번호 자동생성 + 파일명 고유번호 지정 + 구글드라이브 폴더 연계)
// ====================================================================

/**
 * 학교 고유번호(학교코드) 실시간 계산
 * 공식: 연도 + 학교명 앞 4글자 (예: 2026서울과고)
 */
function getCalculatedSchoolCode() {
  const yearInput = document.getElementById('school-year');
  const nameInput = document.getElementById('school-name');
  const year = yearInput ? yearInput.value.trim() : '2026';
  const name = nameInput ? nameInput.value.trim() : '';
  const prefix = name ? name.substring(0, 4) : '미입력';
  return `${year}${prefix}`;
}

function updateGeneratedCodePreview() {
  const code = getCalculatedSchoolCode();
  const previewEl = document.getElementById('preview-school-code');
  if (previewEl) previewEl.textContent = code;

  // 파일 업로드 시 저장 예정 파일명도 실시간 갱신
  const targetFileEl = document.getElementById('target-upload-filename');
  if (targetFileEl && state.selectedFile) {
    const ext = state.selectedFile.name.split('.').pop() || 'pdf';
    targetFileEl.textContent = `${code}.${ext}`;
  }
}

function setCurriculumMode(mode) {
  state.curriculumMode = mode;
  const fileBox = document.getElementById('curriculum-file-box');
  const urlBox = document.getElementById('curriculum-url-box');
  const btnFile = document.getElementById('tab-btn-file');
  const btnUrl = document.getElementById('tab-btn-url');

  if (mode === 'file') {
    fileBox.classList.remove('hidden');
    urlBox.classList.add('hidden');
    btnFile.className = 'px-2.5 py-1 rounded bg-white text-slate-800 shadow-2xs font-semibold';
    btnUrl.className = 'px-2.5 py-1 rounded text-slate-500 hover:text-slate-800';
  } else {
    fileBox.classList.add('hidden');
    urlBox.classList.remove('hidden');
    btnUrl.className = 'px-2.5 py-1 rounded bg-white text-slate-800 shadow-2xs font-semibold';
    btnFile.className = 'px-2.5 py-1 rounded text-slate-500 hover:text-slate-800';
  }
}

function onCurriculumFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  state.selectedFile = file;
  const code = getCalculatedSchoolCode();
  const ext = file.name.split('.').pop() || 'pdf';

  document.getElementById('selected-filename').textContent = file.name;
  document.getElementById('selected-filesize').textContent = formatBytes(file.size);
  document.getElementById('target-upload-filename').textContent = `${code}.${ext}`;
  document.getElementById('upload-status-badge').textContent = '업로드 준비됨';

  document.getElementById('file-empty-view').classList.add('hidden');
  document.getElementById('file-selected-view').classList.remove('hidden');
  lucide.createIcons();
}

function cancelCurriculumFile() {
  state.selectedFile = null;
  state.uploadedFileUrl = '';
  document.getElementById('school-file-input').value = '';
  document.getElementById('file-selected-view').classList.add('hidden');
  document.getElementById('file-empty-view').classList.remove('hidden');
}

/**
 * 구글 드라이브 폴더 또는 서버 저장소에 동일 학교 고유번호 파일이 존재하는지 확인
 */
async function checkFileExists(schoolCode, filename) {
  try {
    const res = await fetch(`/api/check_file?school_code=${encodeURIComponent(schoolCode)}&filename=${encodeURIComponent(filename)}`);
    const data = await res.json();
    return data.exists === true || data.is_duplicate === true;
  } catch (err) {
    console.error('파일 중복 확인 중 오류:', err);
    return false;
  }
}

/**
 * [모달 1] 구글 드라이브 파일 중복 확인 모달 표시 및 사용자 응답 대기 (Promise)
 */
function promptFileOverwrite(filename) {
  return new Promise((resolve) => {
    state.pendingFileOverwriteResolver = resolve;
    const modal = document.getElementById('file-duplicate-modal');
    const textEl = document.getElementById('dup-filename-text');
    if (textEl) textEl.textContent = filename;
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(() => modal.classList.add('modal-show'), 10);
      lucide.createIcons();
    }
  });
}

function confirmFileDuplicateUpload() {
  const modal = document.getElementById('file-duplicate-modal');
  if (modal) {
    modal.classList.remove('modal-show');
    setTimeout(() => modal.classList.add('hidden'), 200);
  }
  if (state.pendingFileOverwriteResolver) {
    state.pendingFileOverwriteResolver(true); // '삭제 후 업로드' 승인
    state.pendingFileOverwriteResolver = null;
  }
}

function cancelFileDuplicateUpload() {
  const modal = document.getElementById('file-duplicate-modal');
  if (modal) {
    modal.classList.remove('modal-show');
    setTimeout(() => modal.classList.add('hidden'), 200);
  }
  if (state.pendingFileOverwriteResolver) {
    state.pendingFileOverwriteResolver(false); // 업로드 취소
    state.pendingFileOverwriteResolver = null;
  }
}

/**
 * [모달 2] 학교 정보 중복 확인 모달 표시 및 사용자 응답 대기 (Promise)
 */
function promptSchoolDuplicate(schoolCode) {
  return new Promise((resolve) => {
    state.pendingSchoolDuplicateResolver = resolve;
    const modal = document.getElementById('school-duplicate-modal');
    const textEl = document.getElementById('dup-school-code-text');
    if (textEl) textEl.textContent = schoolCode;
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(() => modal.classList.add('modal-show'), 10);
      lucide.createIcons();
    }
  });
}

function confirmSchoolDuplicateSubmit() {
  const modal = document.getElementById('school-duplicate-modal');
  if (modal) {
    modal.classList.remove('modal-show');
    setTimeout(() => modal.classList.add('hidden'), 200);
  }
  if (state.pendingSchoolDuplicateResolver) {
    state.pendingSchoolDuplicateResolver(true); // '수정' (신규 로그로 누적 반영) 승인
    state.pendingSchoolDuplicateResolver = null;
  }
}

function cancelSchoolDuplicateSubmit() {
  const modal = document.getElementById('school-duplicate-modal');
  if (modal) {
    modal.classList.remove('modal-show');
    setTimeout(() => modal.classList.add('hidden'), 200);
  }
  if (state.pendingSchoolDuplicateResolver) {
    state.pendingSchoolDuplicateResolver(false); // 등록 취소
    state.pendingSchoolDuplicateResolver = null;
  }
}

/**
 * 파일을 학교 고유번호 파일명으로 서버 및 구글 드라이브 폴더에 업로드
 * @param {File} file 첨부된 파일 객체
 * @param {string} schoolCode 학교 고유번호 (예: 2026야탑고등)
 * @param {boolean} overwrite 기존 파일이 있을 경우 삭제 후 덮어쓸지 여부
 */
async function uploadFileToServer(file, schoolCode, overwrite = false) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result.split(',')[1];
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            school_code: schoolCode, // 학교 고유번호 전달
            file_base64: base64Data,
            overwrite: overwrite     // 덮어쓰기/삭제 여부 전달
          })
        });
        const result = await res.json();
        if (result.success) {
          // drive_status: 'success' = 드라이브 정상 업로드
          //               'fallback_local' = 드라이브 실패, 로컬 저장됨
          //               'error' = 드라이브 오류, 로컬만 저장됨
          resolve({
            url: result.url,
            driveStatus: result.drive_status || 'unknown',
            isDriveUploaded: result.is_drive_uploaded === true
          });
        } else {
          reject(new Error(result.error || '파일 업로드 실패'));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

/**
 * 학교 기본 정보 등록 처리
 * - 파일 중복 시 대화창 확인 (삭제 후 업로드 vs 취소)
 * - 학교 정보 중복 시 대화창 확인 (수정(신규 로그로 누적) vs 아니오)
 * - E열에 업로드된 파일 링크 반영
 */
async function handleSchoolSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById('school-submit-btn');

  const year = document.getElementById('school-year').value.trim();
  const name = document.getElementById('school-name').value.trim();
  const students = document.getElementById('school-students').value.trim();
  const schoolCode = `${year}${name.substring(0, 4)}`;

  let curriculumLink = '링크입력예정';
  let overwriteFile = false;

  try {
    // -------------------------------------------------------------
    // 단계 1. 교과 편성표 파일 업로드 및 중복 검사
    // -------------------------------------------------------------
    if (state.curriculumMode === 'file' && state.selectedFile) {
      const ext = state.selectedFile.name.split('.').pop() || 'pdf';
      const targetFilename = `${schoolCode}.${ext}`;

      // 구글 드라이브/서버에 기존 파일이 존재하는지 확인
      const fileExists = await checkFileExists(schoolCode, state.selectedFile.name);
      if (fileExists) {
        // 중복 대화창 표시 및 사용자 선택 대기
        const shouldOverwrite = await promptFileOverwrite(targetFilename);
        if (!shouldOverwrite) {
          showToast('파일 업로드가 취소되었습니다.', 'info');
          return; // 진행 중단
        }
        overwriteFile = true;
      }

      btn.disabled = true;
      btn.innerHTML = `<span class="animate-pulse">드라이브 폴더 파일 업로드 중...</span>`;
      document.getElementById('upload-status-badge').textContent = '드라이브 폴더 저장 중...';

      const uploadResult = await uploadFileToServer(state.selectedFile, schoolCode, overwriteFile);
      curriculumLink = uploadResult.url;

      // 드라이브 업로드 성공 여부에 따라 상태 배지 업데이트
      if (uploadResult.isDriveUploaded) {
        document.getElementById('upload-status-badge').textContent = '드라이브 업로드 완료';
      } else {
        document.getElementById('upload-status-badge').textContent = '업로드 완료 (드라이브 연동 확인 필요)';
        console.warn('[파일 업로드] 드라이브 연동 실패, 로컬 저장 URL 사용:', curriculumLink);
      }

    } else if (state.curriculumMode === 'url') {
      const urlVal = document.getElementById('school-curriculum-url').value.trim();
      if (urlVal) curriculumLink = urlVal;
    }

    // -------------------------------------------------------------
    // 단계 2. 학교 정보 중복 확인 (이력 로그 보존 & 새로운 로그 누적)
    // -------------------------------------------------------------
    // 기존에 등록된 학교 정보 중 동일 학교코드가 있는지 탐색
    const existingSchool = state.schools.find(s => s['학교코드(고유값)'] === schoolCode);
    let isUpdateLog = false;

    if (existingSchool) {
      // 학교 정보 중복 대화창 표시 및 사용자 선택 대기
      const shouldUpdate = await promptSchoolDuplicate(schoolCode);
      if (!shouldUpdate) {
        showToast('학교 정보 등록이 취소되었습니다.', 'info');
        return; // 진행 중단
      }
      isUpdateLog = true; // '수정' 승인 -> 기존 로그 보존 및 새로운 로그로 누적 반영
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="animate-pulse">데이터베이스 기록 반영 중...</span>`;

    // -------------------------------------------------------------
    // 단계 3. 학교 기본 정보 데이터베이스 등록 요청
    // -------------------------------------------------------------
    const payload = {
      "연도": year,
      "학교명": name,
      "전교 학생수": students,
      "교과 편성표(링크)": curriculumLink, // E열에 반영
      "is_update_log": isUpdateLog          // 신규 로그 누적 여부
    };

    const res = await fetch('/api/schools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result.success) {
      if (isUpdateLog) {
        showToast(`기존 로그를 보존하고 최신 내용으로 새 로그가 등록되었습니다! (${result.item['학교코드(고유값)']})`, 'success');
      } else {
        showToast(`학교 기본 정보가 성공적으로 등록되었습니다! (${result.item['학교코드(고유값)']})`, 'success');
      }
      
      // 입력 폼 초기화
      document.getElementById('school-name').value = '';
      document.getElementById('school-students').value = '';
      cancelCurriculumFile();
      document.getElementById('school-curriculum-url').value = '';
      updateGeneratedCodePreview();
      
      // 데이터 갱신
      await loadData();
    } else {
      showToast(result.error || '학교 등록에 실패했습니다.', 'error');
    }
  } catch (err) {
    showToast(`오류 발생: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4"></i><span>학교 기본 정보 등록하기</span>`;
    lucide.createIcons();
  }
}

/**
 * 등록된 학교 기본 정보 목록 테이블 렌더링
 * - 과거 이력 로그 포함 여부 토글 지원
 * - 최신 로그 및 과거 이력 구분 뱃지 표시
 */
function renderSchoolsTable() {
  const tableBody = document.getElementById('schools-table-body');
  if (!tableBody) return;

  const showAllLogs = document.getElementById('toggle-show-all-logs')?.checked || false;
  const search = (document.getElementById('school-list-search')?.value || '').toLowerCase().trim();

  // 검색어 및 최신 로그 필터링
  const filtered = state.schools.filter(item => {
    // 1. 과거 이력 로그 표시 체크박스가 꺼져있으면 최신 로그만 표시
    if (!showAllLogs && item._is_latest === false) {
      return false;
    }
    // 2. 검색어 필터링
    if (!search) return true;
    return (
      String(item['학교명'] || '').toLowerCase().includes(search) ||
      String(item['학교코드(고유값)'] || '').toLowerCase().includes(search)
    );
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400">등록된 학교 기본 정보가 없습니다.</td></tr>`;
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const id = item['_id'];
    const code = item['학교코드(고유값)'] || '-';
    const year = item['연도'] || '-';
    const name = item['학교명'] || '-';
    const students = item['전교 학생수'] ? `${item['전교 학생수']}명` : '-';
    const link = item['교과 편성표(링크)'] || '링크입력예정';
    const progress = item['데이터 수집 현황'] || '0 / 10';
    const isLatest = item._is_latest !== false; // 기본값은 최신

    const isLink = link.startsWith('http') || link.startsWith('/');

    html += `
      <tr class="hover:bg-slate-50/80 transition-colors ${!isLatest ? 'bg-slate-50/40 text-slate-400' : ''}">
        <td class="py-3 px-4 font-mono font-bold text-cyan-800 bg-cyan-50/40 rounded">${escapeHtml(code)}</td>
        <td class="py-3 px-4 font-semibold text-slate-700">${escapeHtml(year)}</td>
        <td class="py-3 px-4 font-bold text-slate-900">${escapeHtml(name)}</td>
        <td class="py-3 px-4 text-slate-600">${escapeHtml(students)}</td>
        <td class="py-3 px-4 max-w-xs truncate">
          ${isLink ? `
            <a href="${escapeHtml(link)}" target="_blank" class="inline-flex items-center gap-1 text-cyan-600 hover:text-cyan-800 font-semibold underline">
              <i data-lucide="external-link" class="w-3 h-3"></i>
              <span>편성표 문서 열기</span>
            </a>
          ` : `<span class="text-slate-400 italic">${escapeHtml(link)}</span>`}
        </td>
        <td class="py-3 px-4"><span class="px-2 py-0.5 bg-blue-50 text-blue-700 font-bold rounded">${escapeHtml(progress)}</span></td>
        <td class="py-3 px-4">
          ${isLatest 
            ? `<span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold rounded text-[11px] border border-emerald-200">최신 로그</span>`
            : `<span class="px-2 py-0.5 bg-slate-100 text-slate-500 font-medium rounded text-[11px] border border-slate-200">과거 이력</span>`}
        </td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openEditSchoolModal('${id}')" title="수정" class="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deleteSchoolItem('${id}')" title="삭제" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });
  tableBody.innerHTML = html;
  lucide.createIcons();
}

function openEditSchoolModal(id) {
  const item = state.schools.find(s => s['_id'] === id);
  if (!item) return;

  document.getElementById('edit-school-id').value = item['_id'];
  document.getElementById('edit-school-year').value = item['연도'] || 2026;
  document.getElementById('edit-school-name').value = item['학교명'] || '';
  document.getElementById('edit-school-students').value = item['전교 학생수'] || '';
  document.getElementById('edit-school-progress').value = item['데이터 수집 현황'] || '0 / 10';
  document.getElementById('edit-school-curriculum').value = item['교과 편성표(링크)'] || '';

  const modal = document.getElementById('edit-school-modal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('modal-show'), 10);
  lucide.createIcons();
}

function closeEditSchoolModal() {
  const modal = document.getElementById('edit-school-modal');
  modal.classList.remove('modal-show');
  setTimeout(() => modal.classList.add('hidden'), 200);
}

async function handleSchoolUpdate(event) {
  event.preventDefault();
  const id = document.getElementById('edit-school-id').value;
  const payload = {
    "_id": id,
    "연도": document.getElementById('edit-school-year').value.trim(),
    "학교명": document.getElementById('edit-school-name').value.trim(),
    "전교 학생수": document.getElementById('edit-school-students').value.trim(),
    "데이터 수집 현황": document.getElementById('edit-school-progress').value.trim(),
    "교과 편성표(링크)": document.getElementById('edit-school-curriculum').value.trim()
  };

  try {
    const res = await fetch('/api/schools', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      showToast('학교 기본 정보가 수정되었습니다.', 'success');
      closeEditSchoolModal();
      await loadData();
    } else {
      showToast(result.error || '수정 실패', 'error');
    }
  } catch (e) {
    showToast('수정 처리 중 오류가 발생했습니다.', 'error');
  }
}

async function deleteSchoolItem(id) {
  if (!confirm('이 학교 기본 정보를 삭제하시겠습니까?')) return;
  try {
    const res = await fetch('/api/schools', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: id })
    });
    const result = await res.json();
    if (result.success) {
      showToast('성공적으로 삭제되었습니다.', 'success');
      await loadData();
    } else {
      showToast(result.error || '삭제 실패', 'error');
    }
  } catch (e) {
    showToast('삭제 중 오류가 발생했습니다.', 'error');
  }
}

// ====================================================================
// 5. [입력 탭 2] 수시 합격 데이터 CRUD
// ====================================================================
async function handleSushiSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById('sushi-submit-btn');
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-pulse">저장 중...</span>`;

  const payload = {
    "연도": parseInt(document.getElementById('sushi-year').value, 10),
    "학교명": document.getElementById('sushi-school').value.trim(),
    "전교 등수": document.getElementById('sushi-rank').value.trim(),
    "내신 등급": document.getElementById('sushi-grade').value.trim(),
    "합격 대학": document.getElementById('sushi-univ').value.trim(),
    "합격 학과": document.getElementById('sushi-dept').value.trim(),
    "전형명": document.getElementById('sushi-type').value.trim(),
    "입력자": document.getElementById('sushi-author').value.trim()
  };

  try {
    const res = await fetch('/api/sushi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result.success) {
      showToast('수시 합격 데이터가 성공적으로 등록되었습니다!', 'success');
      document.getElementById('sushi-rank').value = '';
      document.getElementById('sushi-univ').value = '';
      document.getElementById('sushi-dept').value = '';
      document.getElementById('sushi-grade').value = '';
      await loadData();
    } else {
      showToast(result.error || '저장에 실패했습니다.', 'error');
    }
  } catch (err) {
    showToast('서버 통신 오류', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4"></i><span>수시 합격 데이터 저장하기</span>`;
    lucide.createIcons();
  }
}

function renderSushiTable() {
  const tableBody = document.getElementById('sushi-table-body');
  if (!tableBody) return;
  const search = (document.getElementById('sushi-search-input')?.value || '').toLowerCase().trim();

  const filtered = state.sushi.filter(item => {
    if (!search) return true;
    return (
      String(item['학교명'] || '').toLowerCase().includes(search) ||
      String(item['합격 대학'] || '').toLowerCase().includes(search) ||
      String(item['합격 학과'] || '').toLowerCase().includes(search)
    );
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-slate-400">등록된 수시 합격 데이터가 없습니다.</td></tr>`;
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const id = item['_id'];
    html += `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3 px-4 text-slate-500 font-mono text-[11px]">${formatDate(item['입력 일시'])}</td>
        <td class="py-3 px-4 font-semibold text-slate-700">${item['연도'] || '-'}</td>
        <td class="py-3 px-4 font-bold text-slate-900">${escapeHtml(item['학교명'] || '-')}</td>
        <td class="py-3 px-4"><span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-bold">${escapeHtml(item['전교 등수'] || '-')}</span></td>
        <td class="py-3 px-4 font-semibold text-slate-900">${escapeHtml(item['합격 대학'] || '-')} <span class="text-blue-600">${escapeHtml(item['합격 학과'] || '')}</span></td>
        <td class="py-3 px-4 text-slate-600">${escapeHtml(item['전형명'] || '-')}</td>
        <td class="py-3 px-4 text-slate-600">${item['내신 등급'] || '-'}</td>
        <td class="py-3 px-4 text-slate-500">${escapeHtml(item['입력자'] || '-')}</td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openEditSushiModal('${id}')" title="수정" class="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deleteSushiItem('${id}')" title="삭제" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });
  tableBody.innerHTML = html;
  lucide.createIcons();
}

function openEditSushiModal(id) {
  const item = state.sushi.find(s => s['_id'] === id);
  if (!item) return;

  document.getElementById('edit-sushi-id').value = item['_id'];
  document.getElementById('edit-sushi-year').value = item['연도'] || 2026;
  document.getElementById('edit-sushi-school').value = item['학교명'] || '';
  document.getElementById('edit-sushi-rank').value = item['전교 등수'] || '';
  document.getElementById('edit-sushi-grade').value = item['내신 등급'] || '';
  document.getElementById('edit-sushi-univ').value = item['합격 대학'] || '';
  document.getElementById('edit-sushi-dept').value = item['합격 학과'] || '';
  document.getElementById('edit-sushi-type').value = item['전형명'] || '';
  document.getElementById('edit-sushi-author').value = item['입력자'] || '';

  const modal = document.getElementById('edit-sushi-modal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('modal-show'), 10);
  lucide.createIcons();
}

function closeEditSushiModal() {
  const modal = document.getElementById('edit-sushi-modal');
  modal.classList.remove('modal-show');
  setTimeout(() => modal.classList.add('hidden'), 200);
}

async function handleSushiUpdate(event) {
  event.preventDefault();
  const id = document.getElementById('edit-sushi-id').value;
  const payload = {
    "_id": id,
    "연도": parseInt(document.getElementById('edit-sushi-year').value, 10),
    "학교명": document.getElementById('edit-sushi-school').value.trim(),
    "전교 등수": document.getElementById('edit-sushi-rank').value.trim(),
    "내신 등급": document.getElementById('edit-sushi-grade').value.trim(),
    "합격 대학": document.getElementById('edit-sushi-univ').value.trim(),
    "합격 학과": document.getElementById('edit-sushi-dept').value.trim(),
    "전형명": document.getElementById('edit-sushi-type').value.trim(),
    "입력자": document.getElementById('edit-sushi-author').value.trim()
  };

  try {
    const res = await fetch('/api/sushi', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      showToast('수시 합격 정보가 수정되었습니다.', 'success');
      closeEditSushiModal();
      await loadData();
    } else {
      showToast(result.error || '수정 실패', 'error');
    }
  } catch (e) {
    showToast('수정 처리 중 오류', 'error');
  }
}

async function deleteSushiItem(id) {
  if (!confirm('이 수시 합격 데이터를 정말 삭제하시겠습니까?')) return;
  try {
    const res = await fetch('/api/sushi', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: id })
    });
    const result = await res.json();
    if (result.success) {
      showToast('삭제되었습니다.', 'success');
      await loadData();
    } else {
      showToast(result.error || '삭제 실패', 'error');
    }
  } catch (e) {
    showToast('삭제 오류', 'error');
  }
}

// ====================================================================
// 6. [입력 탭 3] 특별 프로그램 CRUD
// ====================================================================
async function handleProgramSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById('prog-submit-btn');
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-pulse">저장 중...</span>`;

  const payload = {
    "연도": parseInt(document.getElementById('prog-year').value, 10),
    "학교명": document.getElementById('prog-school').value.trim(),
    "프로그램 명칭": document.getElementById('prog-title').value.trim(),
    "프로그램 주요 내용": document.getElementById('prog-desc').value.trim(),
    "입력자": document.getElementById('prog-author').value.trim()
  };

  try {
    const res = await fetch('/api/programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      showToast('특별 프로그램이 등록되었습니다!', 'success');
      document.getElementById('prog-title').value = '';
      document.getElementById('prog-desc').value = '';
      await loadData();
    } else {
      showToast(result.error || '저장 실패', 'error');
    }
  } catch (err) {
    showToast('통신 오류', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4"></i><span>특별 프로그램 저장하기</span>`;
    lucide.createIcons();
  }
}

function renderProgTable() {
  const tableBody = document.getElementById('prog-table-body');
  if (!tableBody) return;
  const search = (document.getElementById('prog-search-input')?.value || '').toLowerCase().trim();

  const filtered = state.programs.filter(item => {
    if (!search) return true;
    return (
      String(item['학교명'] || '').toLowerCase().includes(search) ||
      String(item['프로그램 명칭'] || '').toLowerCase().includes(search)
    );
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">등록된 특별 프로그램이 없습니다.</td></tr>`;
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const id = item['_id'];
    html += `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3 px-4 text-slate-500 font-mono text-[11px]">${formatDate(item['입력 일시'])}</td>
        <td class="py-3 px-4 font-semibold text-slate-700">${item['연도'] || '-'}</td>
        <td class="py-3 px-4 font-bold text-slate-900">${escapeHtml(item['학교명'] || '-')}</td>
        <td class="py-3 px-4 font-bold text-amber-900 bg-amber-50/60 rounded">${escapeHtml(item['프로그램 명칭'] || '-')}</td>
        <td class="py-3 px-4 text-slate-600 max-w-sm whitespace-pre-line truncate">${escapeHtml(item['프로그램 주요 내용'] || '-')}</td>
        <td class="py-3 px-4 text-slate-500">${escapeHtml(item['입력자'] || '-')}</td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openEditProgModal('${id}')" title="수정" class="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deleteProgItem('${id}')" title="삭제" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });
  tableBody.innerHTML = html;
  lucide.createIcons();
}

function openEditProgModal(id) {
  const item = state.programs.find(p => p['_id'] === id);
  if (!item) return;

  document.getElementById('edit-prog-id').value = item['_id'];
  document.getElementById('edit-prog-year').value = item['연도'] || 2026;
  document.getElementById('edit-prog-school').value = item['학교명'] || '';
  document.getElementById('edit-prog-title').value = item['프로그램 명칭'] || '';
  document.getElementById('edit-prog-desc').value = item['프로그램 주요 내용'] || '';
  document.getElementById('edit-prog-author').value = item['입력자'] || '';

  const modal = document.getElementById('edit-prog-modal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('modal-show'), 10);
  lucide.createIcons();
}

function closeEditProgModal() {
  const modal = document.getElementById('edit-prog-modal');
  modal.classList.remove('modal-show');
  setTimeout(() => modal.classList.add('hidden'), 200);
}

async function handleProgUpdate(event) {
  event.preventDefault();
  const id = document.getElementById('edit-prog-id').value;
  const payload = {
    "_id": id,
    "연도": parseInt(document.getElementById('edit-prog-year').value, 10),
    "학교명": document.getElementById('edit-prog-school').value.trim(),
    "프로그램 명칭": document.getElementById('edit-prog-title').value.trim(),
    "프로그램 주요 내용": document.getElementById('edit-prog-desc').value.trim(),
    "입력자": document.getElementById('edit-prog-author').value.trim()
  };

  try {
    const res = await fetch('/api/programs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      showToast('특별 프로그램이 수정되었습니다.', 'success');
      closeEditProgModal();
      await loadData();
    } else {
      showToast(result.error || '수정 실패', 'error');
    }
  } catch (e) {
    showToast('수정 처리 오류', 'error');
  }
}

async function deleteProgItem(id) {
  if (!confirm('이 특별 프로그램을 정말 삭제하시겠습니까?')) return;
  try {
    const res = await fetch('/api/programs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: id })
    });
    const result = await res.json();
    if (result.success) {
      showToast('삭제되었습니다.', 'success');
      await loadData();
    } else {
      showToast(result.error || '삭제 실패', 'error');
    }
  } catch (e) {
    showToast('삭제 오류', 'error');
  }
}

// ====================================================================
// 7. [보기 탭] 대시보드 및 상세 모달
// ====================================================================
function setViewMode(mode) {
  state.viewMode = mode;
  const deckContainer = document.getElementById('deck-view-container');
  const tableContainer = document.getElementById('table-view-container');
  const btnDeck = document.getElementById('view-mode-deck');
  const btnTable = document.getElementById('view-mode-table');

  if (mode === 'deck') {
    deckContainer.classList.remove('hidden');
    tableContainer.classList.add('hidden');
    btnDeck.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-white text-slate-900 shadow-xs';
    btnTable.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-500 hover:text-slate-800';
  } else {
    deckContainer.classList.add('hidden');
    tableContainer.classList.remove('hidden');
    btnTable.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-white text-slate-900 shadow-xs';
    btnDeck.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-500 hover:text-slate-800';
  }
}

function renderDashboard() {
  const yearFilter = document.getElementById('filter-year')?.value || 'ALL';
  const keyword = (document.getElementById('filter-keyword')?.value || '').trim().toLowerCase();

  // 대시보드는 최신 로그 기준으로만 표출 (_is_latest !== false)
  const filteredSchools = state.schools.filter(school => {
    if (school._is_latest === false) return false; // 과거 이력 로그 제외
    const schoolYear = String(school['연도'] || '');
    const schoolName = String(school['학교명'] || '').toLowerCase();
    const matchesYear = (yearFilter === 'ALL' || schoolYear === yearFilter);
    const matchesKeyword = (!keyword || schoolName.includes(keyword));
    return matchesYear && matchesKeyword;
  });

  const deckContainer = document.getElementById('deck-view-container');
  const tableBody = document.getElementById('dashboard-table-body');
  if (!deckContainer || !tableBody) return;

  if (filteredSchools.length === 0) {
    const emptyHtml = `
      <div class="col-span-full py-16 text-center bg-white rounded-2xl border border-slate-200">
        <i data-lucide="search-x" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
        <p class="text-sm font-bold text-slate-700">조건에 맞는 학교 데이터가 없습니다.</p>
        <p class="text-xs text-slate-400 mt-1">[학교 기본 정보 입력] 탭에서 신규 학교를 등록해 보세요.</p>
      </div>
    `;
    deckContainer.innerHTML = emptyHtml;
    tableBody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-400">${emptyHtml}</td></tr>`;
    lucide.createIcons();
    return;
  }

  // 카드 덱 뷰
  let deckHtml = '';
  filteredSchools.forEach(school => {
    const schoolName = school['학교명'] || '미지정';
    const year = school['연도'] || 2026;
    const students = school['전교 학생수'] || '-';
    const rawProgress = school['데이터 수집 현황'] || '0 / 10';
    const progressPercent = calculateProgressPercent(rawProgress, schoolName, year);

    const summaryItem = state.dashboard.find(d => 
      String(d['학교명']).trim() === String(schoolName).trim() &&
      String(d['연도']).trim() === String(year).trim()
    );

    const sushiSummary = summaryItem ? summaryItem['전교 1~10등 수시 합격 종합'] : '';
    const progSummary = summaryItem ? summaryItem['진행 중인 특별 프로그램'] : '';

    deckHtml += `
      <div onclick="openSchoolDetail('${escapeHtml(schoolName)}', '${year}')" class="school-card bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs cursor-pointer flex flex-col justify-between group">
        <div>
          <div class="flex items-start justify-between mb-4">
            <div>
              <span class="text-[11px] font-bold text-cyan-700 bg-cyan-50 px-2.5 py-0.5 rounded-full border border-cyan-100">${year}학년도</span>
              <h3 class="text-xl font-bold text-slate-900 mt-1.5 group-hover:text-cyan-600 transition-colors">${escapeHtml(schoolName)}</h3>
              <p class="text-xs text-slate-400">전교생: <span class="font-semibold text-slate-700">${students}명</span></p>
            </div>
            <div class="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 group-hover:bg-cyan-600 group-hover:text-white flex items-center justify-center transition-all duration-200 shadow-xs">
              <i data-lucide="chevron-right" class="w-5 h-5"></i>
            </div>
          </div>

          <div class="mb-5 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
            <div class="flex items-center justify-between text-xs mb-1.5">
              <span class="font-semibold text-slate-600">수시 합격 데이터 수집</span>
              <span class="font-bold text-blue-600">${progressPercent.text} (${progressPercent.percent}%)</span>
            </div>
            <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div class="bg-blue-600 h-full rounded-full transition-all duration-500" style="width: ${progressPercent.percent}%"></div>
            </div>
          </div>

          <div class="space-y-3 mb-4">
            <div class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <i data-lucide="award" class="w-3.5 h-3.5 text-blue-500"></i>
              <span>전교 1~10등 수시 합격 종합</span>
            </div>
            <div class="bg-slate-50/80 p-3 rounded-xl border border-slate-100 text-xs text-slate-600 whitespace-pre-line leading-relaxed max-h-24 overflow-hidden text-ellipsis line-clamp-3">
              ${sushiSummary ? escapeHtml(sushiSummary) : '<span class="text-slate-400 italic">등록된 종합 합격 내역이 없습니다.</span>'}
            </div>
          </div>

          <div class="space-y-1.5">
            <div class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-500"></i>
              <span>진행 중인 특별 프로그램</span>
            </div>
            <p class="text-xs text-slate-600 truncate bg-amber-50/60 text-amber-900 px-3 py-2 rounded-lg border border-amber-100 font-medium">
              ${progSummary ? escapeHtml(progSummary) : '<span class="text-slate-400 font-normal">등록된 특별 프로그램이 없습니다.</span>'}
            </p>
          </div>
        </div>

        <div class="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span>클릭하여 상담 상세 보기</span>
          <span class="text-cyan-600 font-semibold flex items-center gap-1">
            상세보기 <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
          </span>
        </div>
      </div>
    `;
  });
  deckContainer.innerHTML = deckHtml;

  // 테이블 뷰
  let tableHtml = '';
  filteredSchools.forEach(school => {
    const schoolName = school['학교명'] || '미지정';
    const year = school['연도'] || 2026;
    const students = school['전교 학생수'] || '-';
    const rawProgress = school['데이터 수집 현황'] || '0 / 10';
    const progressPercent = calculateProgressPercent(rawProgress, schoolName, year);

    const summaryItem = state.dashboard.find(d => 
      String(d['학교명']).trim() === String(schoolName).trim() &&
      String(d['연도']).trim() === String(year).trim()
    );

    const sushiSummary = summaryItem ? summaryItem['전교 1~10등 수시 합격 종합'] : '-';
    const progSummary = summaryItem ? summaryItem['진행 중인 특별 프로그램'] : '-';

    tableHtml += `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3.5 px-5 font-semibold text-slate-600">${year}년</td>
        <td class="py-3.5 px-5 font-bold text-slate-900">${escapeHtml(schoolName)}</td>
        <td class="py-3.5 px-5 text-slate-600">${students}명</td>
        <td class="py-3.5 px-5">
          <div class="flex items-center gap-2">
            <span class="font-bold text-blue-600">${progressPercent.text}</span>
            <div class="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden hidden sm:block">
              <div class="bg-blue-600 h-full rounded-full" style="width: ${progressPercent.percent}%"></div>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-5 text-slate-700 whitespace-pre-line max-w-xs truncate">${escapeHtml(sushiSummary)}</td>
        <td class="py-3.5 px-5 text-slate-700 max-w-xs truncate">${escapeHtml(progSummary)}</td>
        <td class="py-3.5 px-5 text-center">
          <button onclick="openSchoolDetail('${escapeHtml(schoolName)}', '${year}')" class="px-3 py-1.5 bg-cyan-50 hover:bg-cyan-600 text-cyan-700 hover:text-white rounded-lg font-semibold text-xs transition-colors">
            상담 보기
          </button>
        </td>
      </tr>
    `;
  });
  tableBody.innerHTML = tableHtml;
  lucide.createIcons();
}

function calculateProgressPercent(rawText, schoolName, year) {
  const count = state.sushi.filter(s => 
    String(s['학교명']).trim() === String(schoolName).trim() &&
    String(s['연도']).trim() === String(year).trim()
  ).length;

  let totalTarget = 10;
  if (typeof rawText === 'string' && rawText.includes('/')) {
    const parts = rawText.split('/');
    const parsedTarget = parseInt(parts[1].trim(), 10);
    if (!isNaN(parsedTarget) && parsedTarget > 0) totalTarget = parsedTarget;
  }

  const finalCount = Math.max(count, parseInt(rawText) || 0);
  const percent = Math.min(100, Math.round((finalCount / totalTarget) * 100));

  return { count: finalCount, total: totalTarget, text: `${finalCount} / ${totalTarget}`, percent };
}

function openSchoolDetail(schoolName, year) {
  const school = state.schools.find(s => 
    String(s['학교명']).trim() === String(schoolName).trim() &&
    String(s['연도']).trim() === String(year).trim()
  ) || {
    '학교명': schoolName,
    '연도': year,
    '전교 학생수': '-',
    '학교코드(고유값)': `${year}${schoolName.substring(0, 4)}`,
    '교과 편성표(링크)': ''
  };

  state.selectedSchool = school;

  document.getElementById('modal-school-name').textContent = school['학교명'];
  document.getElementById('modal-school-year').textContent = `${school['연도'] || year}학년도`;
  document.getElementById('modal-school-code').textContent = `학교 고유번호: ${school['학교코드(고유값)'] || '-'}`;
  document.getElementById('modal-school-students').textContent = school['전교 학생수'] ? `${school['전교 학생수']}명` : '정보 없음';

  const progress = calculateProgressPercent(school['데이터 수집 현황'], schoolName, year);
  document.getElementById('modal-school-progress-text').textContent = progress.text;
  document.getElementById('modal-school-percent').textContent = `${progress.percent}%`;
  document.getElementById('modal-school-progress-bar').style.width = `${progress.percent}%`;

  const link = school['교과 편성표(링크)'];
  const linkEl = document.getElementById('modal-school-curriculum-link');
  const noneEl = document.getElementById('modal-curriculum-none');

  if (link && (link.startsWith('http') || link.startsWith('/'))) {
    linkEl.href = link;
    linkEl.classList.remove('hidden');
    noneEl.classList.add('hidden');
  } else {
    linkEl.classList.add('hidden');
    noneEl.classList.remove('hidden');
    noneEl.textContent = link ? link : '등록된 링크 없음';
  }

  renderModalSushiList(schoolName, year);
  renderModalProgramList(schoolName, year);

  const modal = document.getElementById('detail-modal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('modal-show'), 10);
  lucide.createIcons();
}

function closeDetailModal() {
  const modal = document.getElementById('detail-modal');
  modal.classList.remove('modal-show');
  setTimeout(() => modal.classList.add('hidden'), 200);
}

function renderModalSushiList(schoolName, year) {
  const container = document.getElementById('modal-sushi-list');
  const schoolSushi = state.sushi.filter(s => 
    String(s['학교명']).trim() === String(schoolName).trim() &&
    String(s['연도']).trim() === String(year).trim()
  );

  schoolSushi.sort((a, b) => {
    const rankA = parseInt(String(a['전교 등수']).replace(/[^0-9]/g, '')) || 999;
    const rankB = parseInt(String(b['전교 등수']).replace(/[^0-9]/g, '')) || 999;
    return rankA - rankB;
  });

  const dashboardItem = state.dashboard.find(d => 
    String(d['학교명']).trim() === String(schoolName).trim() &&
    String(d['연도']).trim() === String(year).trim()
  );
  const rawSummaryText = dashboardItem ? dashboardItem['전교 1~10등 수시 합격 종합'] : '';

  if (schoolSushi.length === 0 && !rawSummaryText) {
    container.innerHTML = `<div class="p-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400">등록된 수시 합격 데이터가 없습니다. [수시합격 입력] 탭에서 등록해 주세요.</div>`;
    return;
  }

  let html = '';
  if (schoolSushi.length > 0) {
    html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
    schoolSushi.forEach(item => {
      const rank = item['전교 등수'] || '-';
      const univ = item['합격 대학'] || '-';
      const dept = item['합격 학과'] || '-';
      const type = item['전형명'] || '-';
      const grade = item['내신 등급'] ? `내신 ${item['내신 등급']}` : '';

      html += `
        <div class="bg-gradient-to-r from-blue-50/50 to-indigo-50/30 p-3.5 rounded-xl border border-blue-100 flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <span class="w-10 h-10 rounded-lg bg-blue-600 text-white font-extrabold text-sm flex items-center justify-center shadow-xs">${escapeHtml(rank)}</span>
            <div>
              <div class="font-bold text-slate-900 text-sm">${escapeHtml(univ)} <span class="text-blue-700">${escapeHtml(dept)}</span></div>
              <div class="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                <span class="bg-white px-2 py-0.5 rounded border border-slate-200 font-medium">${escapeHtml(type)}</span>
                ${grade ? `<span class="bg-blue-100/60 text-blue-800 px-2 py-0.5 rounded font-semibold">${escapeHtml(grade)}</span>` : ''}
              </div>
            </div>
          </div>
          <span class="text-[11px] text-slate-400 font-medium">${escapeHtml(item['입력자'] || '')}</span>
        </div>
      `;
    });
    html += '</div>';
  }

  if (rawSummaryText) {
    html += `
      <div class="mt-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
        <span class="text-xs font-bold text-slate-700 block mb-1.5 flex items-center gap-1.5">
          <i data-lucide="clipboard-check" class="w-3.5 h-3.5 text-blue-600"></i>
          시트 자동 집계 요약문 ('대시보드_집계용')
        </span>
        <div class="text-xs text-slate-600 whitespace-pre-line leading-relaxed font-mono bg-white p-3 rounded-lg border border-slate-200/80">${escapeHtml(rawSummaryText)}</div>
      </div>
    `;
  }
  container.innerHTML = html;
}

function renderModalProgramList(schoolName, year) {
  const container = document.getElementById('modal-program-list');
  const schoolProgs = state.programs.filter(p => 
    String(p['학교명']).trim() === String(schoolName).trim() &&
    String(p['연도']).trim() === String(year).trim()
  );

  const dashboardItem = state.dashboard.find(d => 
    String(d['학교명']).trim() === String(schoolName).trim() &&
    String(d['연도']).trim() === String(year).trim()
  );
  const rawProgSummary = dashboardItem ? dashboardItem['진행 중인 특별 프로그램'] : '';

  if (schoolProgs.length === 0 && !rawProgSummary) {
    container.innerHTML = `<div class="p-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400">등록된 특별 프로그램이 없습니다. [특별프로그램 입력] 탭에서 등록해 주세요.</div>`;
    return;
  }

  let html = '';
  if (schoolProgs.length > 0) {
    schoolProgs.forEach(prog => {
      html += `
        <div class="bg-amber-50/40 p-4 rounded-2xl border border-amber-100 space-y-2">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-amber-500"></span>
              ${escapeHtml(prog['프로그램 명칭'] || '')}
            </h4>
            <span class="text-[11px] text-slate-400">작성자: ${escapeHtml(prog['입력자'] || '-')}</span>
          </div>
          <p class="text-xs text-slate-700 whitespace-pre-line bg-white p-3 rounded-xl border border-amber-100/80 leading-relaxed">${escapeHtml(prog['프로그램 주요 내용'] || '')}</p>
        </div>
      `;
    });
  } else if (rawProgSummary) {
    html += `
      <div class="p-4 bg-amber-50/60 rounded-xl border border-amber-200/80">
        <h4 class="text-xs font-bold text-amber-900 mb-1">시트 집계 프로그램 명칭</h4>
        <p class="text-xs text-slate-700 whitespace-pre-line font-medium">${escapeHtml(rawProgSummary)}</p>
      </div>
    `;
  }
  container.innerHTML = html;
}

// ====================================================================
// 8. 관리자 전용 연동 설정 모달
// ====================================================================
function openSettingsModal() {
  if (!state.user || state.user.role !== 'admin') {
    showToast('설정 변경 권한이 없습니다. (관리자 전용)', 'error');
    return;
  }
  const input = document.getElementById('settings-gas-url');
  if (input) input.value = state.config.apps_script_url || '';

  const modal = document.getElementById('settings-modal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('modal-show'), 10);
  lucide.createIcons();
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  modal.classList.remove('modal-show');
  setTimeout(() => modal.classList.add('hidden'), 200);
}

async function saveSettings() {
  if (!state.user || state.user.role !== 'admin') {
    showToast('관리자만 설정을 저장할 수 있습니다.', 'error');
    return;
  }

  const gasUrl = document.getElementById('settings-gas-url').value.trim();
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apps_script_url: gasUrl,
        user_role: state.user.role
      })
    });
    const result = await res.json();
    if (result.success) {
      state.config.apps_script_url = gasUrl;
      showToast('연동 설정이 저장되었습니다.', 'success');
      closeSettingsModal();
    } else {
      showToast(result.error || '저장 실패', 'error');
    }
  } catch (e) {
    showToast('설정 저장 중 오류 발생', 'error');
  }
}

// ====================================================================
// 9. 공통 유틸리티 함수
// ====================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClass = type === 'success' ? 'bg-emerald-600 text-white' : type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white';
  const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';

  toast.className = `toast-animate flex items-center space-x-2.5 px-4 py-3 rounded-xl shadow-xl text-xs font-semibold ${bgClass} pointer-events-auto`;
  toast.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4"></i><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  lucide.createIcons({ root: toast });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(val) {
  if (!val) return '-';
  if (typeof val === 'string' && val.startsWith('Date(')) {
    const parts = val.replace('Date(', '').replace(')', '').split(',');
    if (parts.length >= 3) {
      const y = parts[0];
      const m = String(parseInt(parts[1]) + 1).padStart(2, '0');
      const d = String(parts[2]).padStart(2, '0');
      return `${y}.${m}.${d}`;
    }
  }
  return String(val).substring(0, 16);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
