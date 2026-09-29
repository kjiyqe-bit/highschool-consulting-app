/**
 * ===================================================================
 * 인근 고등학교 수시 합격 데이터베이스 (상담용) - 통합 프론트엔드 스크립트
 * 파일: app.js
 * ===================================================================
 * [핵심 기능]
 * 1. 사번 Placeholder에 오늘 날짜(YYYYMMDD, '-' 없음) 동적 자동 주입
 * 2. 상담진 14명 전원 로그인 및 관리자(D열) 최고 권한 제어
 * 3. [보기 탭] 학교별/연도별 실시간 종합 집계(Aggregation) 및 상세 뷰어(모달)
 * 4. [입력 탭] 
 *    - 학교 기본 정보 (학생수, 편성표 링크)
 *    - 전교 등수별 수시 합격 현황 (한 학생의 중복 합격 다중 입력 지원)
 *    - 특별 프로그램 및 우수 동아리 정보 누적
 * ===================================================================
 */

// 전역 애플리케이션 상태 객체
const state = {
  user: null,          // 로그인한 사용자 객체 { name, phone, emp_no, role, role_label }
  currentMainTab: 'view', // 'view' (보기 탭) 또는 'input' (입력 탭)
  currentSubTab: 'sushi', // 'sushi', 'programs', 'school'
  schools: [],         // 학교_기본정보 시트 데이터
  sushi: [],           // 수시합격_입력 시트 데이터
  programs: [],        // 특별프로그램_입력 시트 데이터
  dashboard: [],       // 대시보드_집계용 시트 데이터
  config: {
    apps_script_url: ''
  }
};

// ===================================================================
// 1. 초기화 (DOM 로딩 완료 시점)
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1) 사번 입력 칸에 오늘 날짜(YYYYMMDD) 동적 주입
  setDynamicEmpNoPlaceholder();

  // 2) 아이콘 렌더링
  if (window.lucide) lucide.createIcons();

  // 3) 세션 스토리지에서 기존 로그인 정보 복원
  const savedUser = sessionStorage.getItem('consulting_user');
  if (savedUser) {
    try {
      state.user = JSON.parse(savedUser);
      applyUserSession();
    } catch (e) {
      sessionStorage.removeItem('consulting_user');
    }
  }

  // 4) 수시 합격 다중 입력 행 기본 1개 생성
  addSushiSubRow();

  // 5) 서버 데이터 로딩
  loadData();
});

/**
 * 사번 입력 칸의 Placeholder를 오늘 날짜(YYYYMMDD, '-' 없음)로 동적 주입
 */
function setDynamicEmpNoPlaceholder() {
  const empInput = document.getElementById('login-emp-no');
  if (empInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}${mm}${dd}`;
    empInput.placeholder = todayStr;
  }
}

// ===================================================================
// 2. 접근 권한 관리 (로그인 / 세션 / 로그아웃)
// ===================================================================
async function handleLoginSubmit(event) {
  event.preventDefault();

  const nameInput = document.getElementById('login-name');
  const phoneInput = document.getElementById('login-phone');
  const empInput = document.getElementById('login-emp-no');
  const submitBtn = document.getElementById('login-submit-btn');
  const errorBox = document.getElementById('login-error-msg');
  const errorText = document.getElementById('login-error-text');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  const phoneVal = phoneInput ? phoneInput.value.trim() : '';
  const empVal = empInput ? empInput.value.trim() : '';

  if (!nameVal) {
    showLoginError('성명(이름)을 입력해 주세요.');
    return;
  }
  if (!empVal && !phoneVal) {
    showLoginError('사번을 입력해 주세요.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="animate-pulse">인증 확인 중...</span>`;
  errorBox.classList.add('hidden');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameVal,
        phone: phoneVal,
        emp_no: empVal
      })
    });

    const result = await res.json();

    if (result.success && result.user) {
      state.user = result.user;
      sessionStorage.setItem('consulting_user', JSON.stringify(result.user));
      applyUserSession();
      showToast(`${result.user.name}님 환영합니다! (${result.user.role_label})`, 'success');
      
      // 사용자 요구사항 반영: 로그인 성공 시 즉시 '입력 탭'으로 자동 전환!
      switchMainTab('input');
      
      await loadData();
    } else {
      const errMsg = result.error || '접근 권한이 없습니다. 성명, 휴대폰 번호, 사번을 다시 확인해 주세요.';
      showLoginError(errMsg);
      showErrorModal('로그인 인증 실패', errMsg);
    }
  } catch (err) {
    const netErr = '서버 통신 중 오류가 발생했습니다. 네트워크 또는 구글 시트 연결 상태를 확인해 주세요.';
    showLoginError(netErr);
    showErrorModal('통신 오류', netErr);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>인증 및 상담 시스템 접속</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
    if (window.lucide) lucide.createIcons();
  }

  function showLoginError(msg) {
    errorText.textContent = msg;
    errorBox.classList.remove('hidden');
  }
}

function applyUserSession() {
  const loginModal = document.getElementById('login-modal');
  const appContainer = document.getElementById('app-container');

  if (state.user) {
    if (loginModal) loginModal.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');

    // 사용자 정보 표시
    const nameEl = document.getElementById('user-name-display');
    const roleBadge = document.getElementById('user-role-badge');
    const empEl = document.getElementById('user-emp-display');

    if (nameEl) nameEl.textContent = state.user.name;
    if (empEl) empEl.textContent = `사번: ${state.user.emp_no}`;
    if (roleBadge) {
      roleBadge.textContent = state.user.role_label;
      if (state.user.role === 'admin') {
        roleBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300';
      } else {
        roleBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600 border border-slate-200';
      }
    }

    // 관리자(D열) 전용 설정 버튼 제어
    const adminBtn = document.getElementById('admin-settings-btn');
    if (adminBtn) {
      if (state.user.role === 'admin') {
        adminBtn.classList.remove('hidden');
      } else {
        adminBtn.classList.add('hidden');
      }
    }

    // 입력 폼 내 작성자 자동 매핑
    const sushiAuthorEl = document.getElementById('sushi-author-label');
    const progAuthorEl = document.getElementById('prog-author-label');
    if (sushiAuthorEl) sushiAuthorEl.textContent = `${state.user.name} (${state.user.emp_no})`;
    if (progAuthorEl) progAuthorEl.textContent = `${state.user.name} (${state.user.emp_no})`;

    if (window.lucide) lucide.createIcons();
  } else {
    if (loginModal) loginModal.classList.remove('hidden');
    if (appContainer) appContainer.classList.add('hidden');
  }
}

function handleLogout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  state.user = null;
  sessionStorage.removeItem('consulting_user');
  applyUserSession();
  showToast('로그아웃 되었습니다.', 'info');
}

// ===================================================================
// 3. 메인 탭 전환 ([보기 탭] <-> [입력 탭])
// ===================================================================
function switchMainTab(tab) {
  state.currentMainTab = tab;

  const btnView = document.getElementById('tab-btn-view');
  const btnInput = document.getElementById('tab-btn-input');
  const secView = document.getElementById('section-view');
  const secInput = document.getElementById('section-input');

  if (tab === 'view') {
    btnView.classList.add('active');
    btnInput.classList.remove('active');
    secView.classList.remove('hidden');
    secInput.classList.add('hidden');
    renderSchoolList();
  } else {
    btnInput.classList.add('active');
    btnView.classList.remove('active');
    secInput.classList.remove('hidden');
    secView.classList.add('hidden');
  }

  if (window.lucide) lucide.createIcons();
}

// ===================================================================
// 4. 입력 탭 서브 네비게이션 전환 (1.수시 / 2.프로그램 / 3.학교)
// ===================================================================
function switchSubTab(subTab) {
  state.currentSubTab = subTab;

  const tabs = ['sushi', 'programs', 'school'];
  tabs.forEach(t => {
    const btn = document.getElementById(`subtab-btn-${t}`);
    const formCont = document.getElementById(`form-container-${t}`);
    if (t === subTab) {
      if (btn) {
        btn.className = 'sub-tab active px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5';
      }
      if (formCont) formCont.classList.remove('hidden');
    } else {
      if (btn) {
        btn.className = 'sub-tab px-4 py-2.5 rounded-xl text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all flex items-center gap-1.5';
      }
      if (formCont) formCont.classList.add('hidden');
    }
  });

  if (window.lucide) lucide.createIcons();
}

// ===================================================================
// 5. 서버 데이터 로딩 및 동기화
// ===================================================================
async function loadData() {
  const syncEl = document.getElementById('stat-last-synced');
  const countBadge = document.getElementById('school-count-badge');
  if (countBadge) countBadge.textContent = '동기화 중...';

  // 8초 타임아웃 제어용 AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('/api/data', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`서버 응답 오류 (HTTP ${res.status})`);

    const result = await res.json();
    if (result.success && result.data) {
      state.schools = result.data.schools || [];
      state.sushi = result.data.sushi || [];
      state.programs = result.data.programs || [];
      state.dashboard = result.data.dashboard || [];
      if (result.config) state.config = result.config;

      // 동기화 시간 표시
      if (syncEl) syncEl.textContent = result.data.last_synced || '방금 전';

      // 통계, 리스트 및 입력 탭 자동완성 datalist 갱신
      updateStatistics();
      renderSchoolList();
      updateSchoolDatalist();
    } else {
      throw new Error(result.error || '구글 시트 데이터 형식이 올바르지 않습니다.');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[데이터 로딩 실패]', err);
    if (syncEl) syncEl.textContent = '동기화 지연';
    if (countBadge) countBadge.textContent = '동기화 지연';

    if (err.name === 'AbortError') {
      showErrorModal('구글 시트 연동 지연', '구글 시트 데이터 로딩 시간(8초)이 초과되었습니다.\n상단 우측의 [동기화] 버튼을 눌러 다시 시도하거나 인터넷 연결을 확인해 주세요.');
    }
  }
}

async function refreshData() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('animate-spin');

  try {
    await loadData();
    showToast('구글 시트의 최신 데이터를 동기화하였습니다.', 'success');
  } catch (e) {
    showToast('데이터 동기화 중 오류가 발생했습니다.', 'error');
  } finally {
    if (icon) icon.classList.remove('animate-spin');
  }
}

function updateStatistics() {
  const distinctSchools = getAllDistinctSchools();
  const statSchools = document.getElementById('stat-total-schools');
  const statSushi = document.getElementById('stat-total-sushi');
  const statProg = document.getElementById('stat-total-programs');

  if (statSchools) statSchools.innerHTML = `${distinctSchools.length}<span class="text-sm font-normal text-slate-400 ml-1">개교</span>`;
  if (statSushi) statSushi.innerHTML = `${state.sushi.length}<span class="text-sm font-normal text-slate-400 ml-1">건</span>`;
  if (statProg) statProg.innerHTML = `${state.programs.length}<span class="text-sm font-normal text-slate-400 ml-1">건</span>`;
}

/**
 * 입력 탭의 학교명 자동완성 Datalist 동적 갱신
 */
function updateSchoolDatalist() {
  const datalist = document.getElementById('school-datalist');
  if (!datalist) return;

  const distinctSchools = getAllDistinctSchools();
  datalist.innerHTML = distinctSchools.map(s => `<option value="${s}"></option>`).join('');
}

/**
 * 연도 입력값을 순수 4자리 숫자 문자열로 정제 ("2026년" -> "2026")
 */
function cleanYear(val) {
  const s = String(val || '').replace(/[^0-9]/g, '');
  return s.length >= 4 ? s.substring(0, 4) : s;
}

// ===================================================================
// 6. 데이터 종합(Aggregation) 엔진
// ===================================================================
/**
 * 학교 기본정보, 수시합격, 특별프로그램 시트에 존재하는 모든 고유 학교명 추출
 */
function getAllDistinctSchools() {
  const schoolSet = new Set();

  state.schools.forEach(s => {
    const name = (s['학교명'] || '').trim();
    if (name) schoolSet.add(name);
  });

  state.sushi.forEach(s => {
    const name = (s['학교명'] || '').trim();
    if (name) schoolSet.add(name);
  });

  state.programs.forEach(p => {
    const name = (p['학교명'] || '').trim();
    if (name) schoolSet.add(name);
  });

  return Array.from(schoolSet);
}

/**
 * 특정 학교명 및 연도에 대한 모든 누적 데이터를 하나로 종합(Aggregation)
 */
function aggregateSchoolInfo(schoolName, targetYear) {
  const cleanTargetYear = cleanYear(targetYear);

  // 1) 기본 정보 (학생수, 링크 등)
  let schoolInfo = state.schools.find(s => {
    const nameMatch = (s['학교명'] || '').trim() === schoolName;
    const yearMatch = targetYear === 'ALL' || cleanYear(s['연도']) === cleanTargetYear;
    return nameMatch && yearMatch;
  });

  // 해당 연도 기본정보가 없으면 다른 연도에서라도 최신 정보 탐색
  if (!schoolInfo) {
    schoolInfo = state.schools.find(s => (s['학교명'] || '').trim() === schoolName) || {
      '학교명': schoolName,
      '연도': targetYear === 'ALL' ? '2026' : targetYear,
      '전교 학생수': '미등록',
      '교과 편성표(링크)': ''
    };
  }

  // 2) 수시 합격 실적 필터링
  const sushiList = state.sushi.filter(s => {
    const nameMatch = (s['학교명'] || '').trim() === schoolName;
    const yearMatch = targetYear === 'ALL' || cleanYear(s['연도']) === cleanTargetYear;
    return nameMatch && yearMatch;
  });

  // 3) 특별 프로그램 및 우수 동아리 필터링
  const progList = state.programs.filter(p => {
    const nameMatch = (p['학교명'] || '').trim() === schoolName;
    const yearMatch = targetYear === 'ALL' || cleanYear(p['연도']) === cleanTargetYear;
    return nameMatch && yearMatch;
  });

  // 데이터 수집 점수 산출 (최대 10점 기준)
  const collectionScore = Math.min(10, (schoolInfo['전교 학생수'] && schoolInfo['전교 학생수'] !== '미등록' ? 2 : 0) + (sushiList.length > 0 ? 5 : 0) + (progList.length > 0 ? 3 : 0));

  return {
    name: schoolName,
    year: schoolInfo['연도'] || targetYear,
    students: schoolInfo['전교 학생수'] || schoolInfo['전교학생수'] || '미등록',
    link: schoolInfo['교과 편성표(링크)'] || schoolInfo['링크'] || '',
    sushiList: sushiList,
    progList: progList,
    collectionScore: collectionScore
  };
}

// ===================================================================
// 7. [보기 탭] 학교 목록 렌더링 (리스트 뷰)
// ===================================================================
function renderSchoolList() {
  const container = document.getElementById('school-card-grid');
  const countBadge = document.getElementById('school-count-badge');
  const yearFilter = document.getElementById('filter-year') ? document.getElementById('filter-year').value : '2026';
  const searchQuery = document.getElementById('search-school-name') ? document.getElementById('search-school-name').value.trim().toLowerCase() : '';

  if (!container) return;

  const distinctSchools = getAllDistinctSchools();
  let filtered = distinctSchools.filter(schoolName => {
    if (searchQuery && !schoolName.toLowerCase().includes(searchQuery)) {
      return false;
    }
    return true;
  });

  if (countBadge) countBadge.textContent = `(${filtered.length}개교)`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center bg-white rounded-3xl border border-dashed border-slate-300">
        <i data-lucide="inbox" class="w-10 h-10 text-slate-300 mx-auto mb-2"></i>
        <p class="text-sm font-bold text-slate-600">일치하는 학교 정보가 없습니다.</p>
        <p class="text-xs text-slate-400 mt-1">상단 [입력 탭]을 눌러 새로운 학교의 데이터를 등록해 보세요.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map(schoolName => {
    const data = aggregateSchoolInfo(schoolName, yearFilter);
    const initial = schoolName.substring(0, 1);
    const progressPercent = Math.min(100, data.collectionScore * 10);
    const safeSchoolName = schoolName.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `
      <div onclick="openSchoolModal('${safeSchoolName}', '${yearFilter}')" class="school-card bg-white rounded-2xl p-5 border border-slate-200 shadow-sm cursor-pointer space-y-4">
        
        <!-- 학교 헤더 -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black text-lg flex items-center justify-center shadow-md shadow-blue-500/20 flex-shrink-0">
              ${initial}
            </div>
            <div>
              <h3 class="font-extrabold text-slate-900 text-base leading-tight">${schoolName}</h3>
              <p class="text-xs text-slate-400 mt-0.5">전교 학생수: <b class="text-slate-700">${data.students}</b>명</p>
            </div>
          </div>
          <span class="text-[11px] px-2.5 py-1 rounded-full font-bold bg-slate-100 text-slate-600 border border-slate-200">${data.year}년</span>
        </div>

        <!-- 실적 배지 요약 -->
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-100 flex items-center gap-2">
            <i data-lucide="award" class="w-4 h-4 text-emerald-600 flex-shrink-0"></i>
            <div>
              <span class="text-[10px] text-slate-500 block">수시 합격</span>
              <span class="font-bold text-emerald-700">${data.sushiList.length}건</span>
            </div>
          </div>

          <div class="p-2.5 rounded-xl bg-indigo-50/80 border border-indigo-100 flex items-center gap-2">
            <i data-lucide="sparkles" class="w-4 h-4 text-indigo-600 flex-shrink-0"></i>
            <div>
              <span class="text-[10px] text-slate-500 block">프로그램/동아리</span>
              <span class="font-bold text-indigo-700">${data.progList.length}건</span>
            </div>
          </div>
        </div>

        <!-- 수집 진행도 바 -->
        <div class="space-y-1.5 pt-1 border-t border-slate-100">
          <div class="flex justify-between text-[11px]">
            <span class="text-slate-400">데이터 수집 진행도</span>
            <span class="font-bold text-blue-600">${data.collectionScore} / 10</span>
          </div>
          <div class="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
            <div class="h-full bg-blue-600 rounded-full transition-all duration-500" style="width: ${progressPercent}%;"></div>
          </div>
        </div>

      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// ===================================================================
// 8. [상세 화면] 학교 상세 종합 모달 (디테일 뷰)
// ===================================================================
function openSchoolModal(schoolName, year) {
  const modal = document.getElementById('school-detail-modal');
  if (!modal) return;

  const data = aggregateSchoolInfo(schoolName, year);

  // 헤더 정보 세팅
  document.getElementById('modal-school-initial').textContent = schoolName.substring(0, 1);
  document.getElementById('modal-school-name').textContent = schoolName;
  document.getElementById('modal-school-year').textContent = `${data.year}년`;
  document.getElementById('modal-school-sub').textContent = `전교 학생수: ${data.students}명 | 여러 상담진의 입력 데이터 종합`;
  document.getElementById('modal-school-students').textContent = `${data.students} 명`;

  // 교과 편성표 링크 컨테이너
  const linkCont = document.getElementById('modal-curriculum-container');
  if (linkCont) {
    if (data.link && data.link !== '링크입력예정') {
      linkCont.innerHTML = `
        <a href="${data.link}" target="_blank" rel="noopener noreferrer" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 transition-colors">
          <i data-lucide="external-link" class="w-4 h-4"></i>
          <span>교과 편성표 열람하기</span>
        </a>
      `;
    } else {
      linkCont.innerHTML = `<span class="text-xs text-slate-400 bg-slate-100 px-3 py-2 rounded-xl">교과 편성표 링크 미등록</span>`;
    }
  }

  // 1) 전교 등수별 수시 합격 실적 테이블 렌더링
  const sushiTbody = document.getElementById('modal-sushi-tbody');
  const sushiCount = document.getElementById('modal-sushi-count');
  if (sushiCount) sushiCount.textContent = `총 ${data.sushiList.length}건`;

  if (data.sushiList.length === 0) {
    sushiTbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-6 text-slate-400">등록된 수시 합격 데이터가 없습니다.</td>
      </tr>
    `;
  } else {
    // 등수 기준 정렬
    const sortedSushi = [...data.sushiList].sort((a, b) => {
      const numA = parseInt(String(a['전교 등수'] || a['전교등수'] || '999').replace(/[^0-9]/g, '')) || 999;
      const numB = parseInt(String(b['전교 등수'] || b['전교등수'] || '999').replace(/[^0-9]/g, '')) || 999;
      return numA - numB;
    });

    sushiTbody.innerHTML = sortedSushi.map(item => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-2.5 px-3 font-bold text-blue-600">${item['전교 등수'] || item['전교등수'] || '-'}</td>
        <td class="py-2.5 px-3 font-bold text-slate-900">${item['합격 대학'] || item['합격대학'] || '-'}</td>
        <td class="py-2.5 px-3 text-slate-700">${item['합격 학과'] || item['합격학과'] || '-'}</td>
        <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]">${item['전형명'] || '-'}</span></td>
        <td class="py-2.5 px-3 font-bold text-emerald-600">${item['내신 등급'] || item['내신등급'] || '-'}</td>
        <td class="py-2.5 px-3 text-[11px] text-slate-400">${item['입력자'] || '-'}</td>
      </tr>
    `).join('');
  }

  // 2) 특별 프로그램 및 우수 동아리 카드 렌더링
  const progListEl = document.getElementById('modal-prog-list');
  const progCount = document.getElementById('modal-prog-count');
  if (progCount) progCount.textContent = `총 ${data.progList.length}건`;

  if (data.progList.length === 0) {
    progListEl.innerHTML = `
      <div class="col-span-full py-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
        등록된 특별 프로그램 또는 동아리 정보가 없습니다.
      </div>
    `;
  } else {
    progListEl.innerHTML = data.progList.map(item => {
      const title = item['프로그램 명칭'] || item['프로그램명'] || '활동명 없음';
      const content = item['프로그램 주요 내용'] || item['프로그램 내용'] || item['주요 내용'] || '등록된 상세 내용이 없습니다.';
      const author = item['입력자'] || '상담진';
      const isClub = title.includes('[우수동아리]') || title.includes('동아리');

      return `
        <div class="p-4 rounded-xl border ${isClub ? 'bg-indigo-50/40 border-indigo-200' : 'bg-blue-50/40 border-blue-200'} space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isClub ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}">
              ${isClub ? '우수 동아리' : '특별 프로그램'}
            </span>
            <span class="text-[10px] text-slate-400">작성자: ${author}</span>
          </div>
          <h5 class="text-xs font-bold text-slate-900">${title}</h5>
          <p class="text-xs text-slate-600 leading-relaxed bg-white/80 p-2.5 rounded-lg border border-slate-100 whitespace-pre-wrap">${content}</p>
        </div>
      `;
    }).join('');
  }

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeSchoolModal() {
  const modal = document.getElementById('school-detail-modal');
  if (modal) modal.classList.add('hidden');
}

// ===================================================================
// 9. [입력 탭] 수시 합격 다중 입력 (동적 행 추가/삭제)
// ===================================================================
function addSushiSubRow() {
  const container = document.getElementById('sushi-sub-rows');
  if (!container) return;

  const rowId = `sushi-sub-${Date.now()}-${Math.floor(Math.random()*1000)}`;
  const rowHtml = `
    <div id="${rowId}" class="grid grid-cols-1 md:grid-cols-4 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 items-center">
      <div>
        <input type="text" placeholder="합격 대학 (예: 서울대)" required class="sub-univ w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500">
      </div>
      <div>
        <input type="text" placeholder="합격 학과 (예: 의예과)" class="sub-dept w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500">
      </div>
      <div>
        <input type="text" placeholder="전형명 (예: 일반전형, 지균)" class="sub-type w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500">
      </div>
      <div class="flex items-center gap-2">
        <button type="button" onclick="removeSushiSubRow('${rowId}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="이 항목 삭제">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', rowHtml);
  if (window.lucide) lucide.createIcons();
}

function removeSushiSubRow(rowId) {
  const row = document.getElementById(rowId);
  const container = document.getElementById('sushi-sub-rows');
  if (row && container) {
    if (container.children.length <= 1) {
      alert('최소 1개의 합격 대학 항목은 필요합니다.');
      return;
    }
    row.remove();
  }
}

// ===================================================================
// 10. [입력 탭] 폼 제출 처리 (구글 시트 누적 저장)
// ===================================================================

/**
 * 1) 수시 합격 실적 제출
 */
async function handleSushiSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById('sushi-submit-btn');

  const year = document.getElementById('sushi-year').value;
  const schoolInput = document.getElementById('sushi-school');
  const rankInput = document.getElementById('sushi-rank');
  const gradeInput = document.getElementById('sushi-grade');

  const school = schoolInput ? schoolInput.value.trim() : '';
  const rank = rankInput ? rankInput.value.trim() : '';
  const grade = gradeInput ? gradeInput.value.trim() : '';
  const author = state.user ? state.user.name : '상담진';

  if (!school) {
    showErrorModal('입력 항목 누락', '학교명을 입력해 주세요.');
    if (schoolInput) schoolInput.focus();
    return;
  }

  if (!rank) {
    showErrorModal('입력 항목 누락', '전교 등수를 입력해 주세요. (예: 1등, 전교3등)');
    if (rankInput) rankInput.focus();
    return;
  }

  // 다중 대학/학과 추출
  const subRows = document.querySelectorAll('#sushi-sub-rows > div');
  const items = [];

  subRows.forEach(row => {
    const univ = row.querySelector('.sub-univ') ? row.querySelector('.sub-univ').value.trim() : '';
    const dept = row.querySelector('.sub-dept') ? row.querySelector('.sub-dept').value.trim() : '';
    const typeName = row.querySelector('.sub-type') ? row.querySelector('.sub-type').value.trim() : '';

    if (univ) {
      items.push({
        '연도': year,
        '학교명': school,
        '전교 등수': rank,
        '합격 대학': univ,
        '합격 학과': dept,
        '전형명': typeName,
        '내신 등급': grade,
        '입력자': author
      });
    }
  });

  if (items.length === 0) {
    showErrorModal('입력 항목 누락', '합격 대학 및 학과 정보를 최소 1개 이상 입력해 주세요.');
    const firstUnivInput = document.querySelector('#sushi-sub-rows .sub-univ');
    if (firstUnivInput) firstUnivInput.focus();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="animate-pulse">구글 시트에 저장 중...</span>`;

  try {
    const res = await fetch('/api/sushi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });

    const result = await res.json();
    if (result.success) {
      showToast(`'${school}' 수시 합격 데이터 ${items.length}건이 성공적으로 누적 저장되었습니다!`, 'success');
      
      // 폼 초기화 (학교명은 재입력 편의를 위해 유지)
      if (rankInput) rankInput.value = '';
      if (gradeInput) gradeInput.value = '';
      const subRowsCont = document.getElementById('sushi-sub-rows');
      if (subRowsCont) subRowsCont.innerHTML = '';
      addSushiSubRow();

      // 최신 데이터 갱신
      await loadData();
    } else {
      showErrorModal('구글 시트 저장 실패', result.error || '알 수 없는 오류가 발생했습니다.');
    }
  } catch (err) {
    showErrorModal('통신 오류', '서버 통신 중 오류가 발생했습니다. 구글 시트 연동 상태를 확인해 주세요.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>수시 합격 데이터 구글 시트에 누적 저장</span>`;
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * 2) 특별 프로그램 및 우수 동아리 제출
 */
async function handleProgramSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById('prog-submit-btn');

  const category = document.getElementById('prog-category').value;
  const year = document.getElementById('prog-year').value;
  const schoolInput = document.getElementById('prog-school');
  const nameInput = document.getElementById('prog-name');
  const contentInput = document.getElementById('prog-content');

  const school = schoolInput ? schoolInput.value.trim() : '';
  const rawName = nameInput ? nameInput.value.trim() : '';
  const content = contentInput ? contentInput.value.trim() : '';
  const author = state.user ? state.user.name : '상담진';

  if (!school) {
    showErrorModal('입력 항목 누락', '학교명을 입력해 주세요.');
    if (schoolInput) schoolInput.focus();
    return;
  }

  if (!rawName) {
    showErrorModal('입력 항목 누락', '프로그램 또는 동아리 명칭을 입력해 주세요.');
    if (nameInput) nameInput.focus();
    return;
  }

  // 우수동아리 카테고리 선택 시 명칭에 [우수동아리] 태그 자동 부여
  const name = (category === '우수동아리' && !rawName.includes('[우수동아리]')) ? `[우수동아리] ${rawName}` : rawName;

  btn.disabled = true;
  btn.innerHTML = `<span class="animate-pulse">구글 시트에 저장 중...</span>`;

  try {
    const res = await fetch('/api/programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '구분': category,
        '연도': year,
        '학교명': school,
        '프로그램 명칭': name,
        '프로그램 주요 내용': content,
        '입력자': author
      })
    });

    const result = await res.json();
    if (result.success) {
      showToast(`'${name}' 정보가 구글 시트에 성공적으로 저장되었습니다!`, 'success');
      if (nameInput) nameInput.value = '';
      if (contentInput) contentInput.value = '';
      await loadData();
    } else {
      showErrorModal('구글 시트 저장 실패', result.error || '알 수 없는 오류가 발생했습니다.');
    }
  } catch (e) {
    showErrorModal('통신 오류', '서버 통신 중 오류가 발생했습니다. 구글 시트 연동 상태를 확인해 주세요.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>프로그램/동아리 정보 구글 시트에 누적 저장</span>`;
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * 3) 학교 기본 정보 제출
 */
async function handleSchoolSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById('school-submit-btn');

  const year = document.getElementById('school-year').value;
  const nameInput = document.getElementById('school-name');
  const studentsInput = document.getElementById('school-students');
  const linkInput = document.getElementById('school-link');

  const name = nameInput ? nameInput.value.trim() : '';
  const students = studentsInput ? studentsInput.value.trim() : '';
  const link = linkInput ? linkInput.value.trim() : '';

  if (!name) {
    showErrorModal('입력 항목 누락', '학교명을 입력해 주세요.');
    if (nameInput) nameInput.focus();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="animate-pulse">구글 시트에 저장 중...</span>`;

  try {
    const res = await fetch('/api/schools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '연도': year,
        '학교명': name,
        '전교 학생수': students,
        '교과 편성표(링크)': link
      })
    });

    const result = await res.json();
    if (result.success) {
      showToast(`'${name}' 학교 기본 정보가 저장되었습니다!`, 'success');
      await loadData();
    } else {
      showErrorModal('구글 시트 저장 실패', result.error || '알 수 없는 오류가 발생했습니다.');
    }
  } catch (e) {
    showErrorModal('통신 오류', '서버 통신 중 오류가 발생했습니다.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>학교 기본 정보 구글 시트에 저장</span>`;
    if (window.lucide) lucide.createIcons();
  }
}

// ===================================================================
// 11. 관리자 설정 모달
// ===================================================================
function openAdminModal() {
  const modal = document.getElementById('admin-modal');
  const urlInput = document.getElementById('admin-gas-url');
  if (modal && urlInput) {
    urlInput.value = state.config.apps_script_url || '';
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

function closeAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) modal.classList.add('hidden');
}

async function saveAdminConfig() {
  const urlInput = document.getElementById('admin-gas-url');
  const newUrl = urlInput ? urlInput.value.trim() : '';

  if (!newUrl) {
    alert('웹 앱 URL을 입력해 주세요.');
    return;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apps_script_url: newUrl })
    });
    const result = await res.json();
    if (result.success) {
      state.config.apps_script_url = newUrl;
      showToast('구글 연동 설정이 저장되었습니다.', 'success');
      closeAdminModal();
    } else {
      alert(result.error);
    }
  } catch (e) {
    alert('설정 저장 중 오류가 발생했습니다.');
  }
}

// ===================================================================
// 12. 공통 UI 유틸리티
// ===================================================================
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  const bgColors = {
    success: 'bg-emerald-600',
    error: 'bg-rose-600',
    info: 'bg-slate-900'
  };

  toast.className = `fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-xl text-xs font-bold text-white flex items-center gap-2 ${bgColors[type] || 'bg-slate-900'} modal-animate`;
  toast.textContent = message;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

/**
 * 에러/경고 안내 전용 모달 창 표시
 * @param {string} title 안내 제목
 * @param {string} message 세부 안내 내용
 */
function showErrorModal(title, message) {
  const modal = document.getElementById('error-alert-modal');
  const titleEl = document.getElementById('error-modal-title');
  const msgEl = document.getElementById('error-modal-message');

  if (titleEl) titleEl.textContent = title || '확인이 필요합니다';
  if (msgEl) msgEl.textContent = message || '오류가 발생했습니다.';

  if (modal) {
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * 에러/경고 안내 전용 모달 창 닫기
 */
function closeErrorModal() {
  const modal = document.getElementById('error-alert-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// HTML 인라인 온클릭 이벤트 및 외부 호출을 위한 전역 스코프 등록
window.handleLoginSubmit = handleLoginSubmit;
window.handleLogout = handleLogout;
window.switchMainTab = switchMainTab;
window.switchSubTab = switchSubTab;
window.refreshData = refreshData;
window.openSchoolModal = openSchoolModal;
window.closeSchoolModal = closeSchoolModal;
window.openSchoolDetailModal = openSchoolModal;
window.closeSchoolDetailModal = closeSchoolModal;
window.addSushiSubRow = addSushiSubRow;
window.removeSushiSubRow = removeSushiSubRow;
window.handleSushiSubmit = handleSushiSubmit;
window.handleProgramSubmit = handleProgramSubmit;
window.handleSchoolSubmit = handleSchoolSubmit;
window.openAdminModal = openAdminModal;
window.closeAdminModal = closeAdminModal;
window.saveAdminConfig = saveAdminConfig;
window.updateSchoolDatalist = updateSchoolDatalist;
window.cleanYear = cleanYear;
window.showErrorModal = showErrorModal;
window.closeErrorModal = closeErrorModal;

