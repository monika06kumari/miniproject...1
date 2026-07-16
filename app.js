// Determine the API URL dynamically
// When hosted, you MUST replace the fallback URL with your actual backend URL (e.g., 'https://your-backend.onrender.com/api')
const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : 'https://YOUR_BACKEND_URL_HERE/api'; // <-- UPDATE THIS FOR YOUR HOSTED BACKEND

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * sanitizeHTML – prevents XSS by encoding any server-returned string
 * before it is inserted into the DOM via innerHTML / template literals.
 * Use this on ALL user-generated or server-returned content.
 */
function sanitizeHTML(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

/** Session token helpers — stored in sessionStorage (cleared on tab close). */
function getToken() {
    return sessionStorage.getItem('nexus_token') || '';
}
function setToken(token) {
    if (token) sessionStorage.setItem('nexus_token', token);
}
function clearToken() {
    sessionStorage.removeItem('nexus_token');
}

/**
 * authFetch – a drop-in wrapper for fetch() that automatically injects
 * the Authorization: Bearer <token> header and handles 401 responses.
 */
async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
        // Session expired — clear and redirect to login
        clearToken();
        sessionStorage.removeItem('nexus_user');
        location.reload();
        return response;
    }
    return response;
}



// ─── Landing Page Particle Canvas ─────────────────────────────────────────────
(function initLandingCanvas() {
    function start() {
        const canvas = document.getElementById('landing-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let W, H, particles = [];
        const COUNT = 80;

        function resize() {
            W = canvas.width  = window.innerWidth;
            H = canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        function rand(min, max) { return Math.random() * (max - min) + min; }

        for (let i = 0; i < COUNT; i++) {
            particles.push({
                x: rand(0, 1), y: rand(0, 1),
                vx: rand(-0.00012, 0.00012), vy: rand(-0.00012, 0.00012),
                r: rand(1, 2.5)
            });
        }

        function draw() {
            if (!document.getElementById('landing-screen') ||
                document.getElementById('landing-screen').style.display === 'none') return;

            ctx.clearRect(0, 0, W, H);

            // Draw connections
            for (let i = 0; i < particles.length; i++) {
                const a = particles[i];
                for (let j = i + 1; j < particles.length; j++) {
                    const b = particles[j];
                    const dx = (a.x - b.x) * W, dy = (a.y - b.y) * H;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 140) {
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(99,102,241,${0.4 * (1 - dist / 140)})`;
                        ctx.lineWidth = 0.5;
                        ctx.moveTo(a.x * W, a.y * H);
                        ctx.lineTo(b.x * W, b.y * H);
                        ctx.stroke();
                    }
                }
            }

            // Draw nodes
            particles.forEach(p => {
                p.x += p.vx; p.y += p.vy;
                if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0;
                if (p.y < 0) p.y = 1; if (p.y > 1) p.y = 0;
                ctx.beginPath();
                ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(139,92,246,0.7)';
                ctx.fill();
            });

            requestAnimationFrame(draw);
        }
        draw();

        // Animate stat counters
        document.querySelectorAll('.lp-stat-n').forEach(el => {
            const target = +el.dataset.target;
            const duration = 2000;
            const start = performance.now();
            const update = (now) => {
                const t = Math.min((now - start) / duration, 1);
                // easeOutExpo
                const ease = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
                el.textContent = Math.round(ease * target);
                if (t < 1) requestAnimationFrame(update);
            };
            requestAnimationFrame(update);
        });

        // Typewriter effect
        const words = ['projects', 'meetings', 'sprints', 'business'];
        let wordIdx = 0;
        let charIdx = 0;
        let isDeleting = false;
        const twEl = document.getElementById('lp-typewriter');
        
        function type() {
            if (!twEl || document.getElementById('landing-screen')?.style.display === 'none') return;
            
            const currentWord = words[wordIdx];
            if (isDeleting) {
                charIdx--;
            } else {
                charIdx++;
            }
            
            twEl.textContent = currentWord.substring(0, charIdx);
            
            let speed = isDeleting ? 50 : 100;
            
            if (!isDeleting && charIdx === currentWord.length) {
                speed = 2000; // Pause at end of word
                isDeleting = true;
            } else if (isDeleting && charIdx === 0) {
                isDeleting = false;
                wordIdx = (wordIdx + 1) % words.length;
                speed = 500; // Pause before typing new word
            }
            
            setTimeout(type, speed);
        }
        
        setTimeout(type, 1000); // Start after 1s
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();


let currentView = 'dashboard';

// Helper to check if a "HH:MM" meeting time today has passed
function isMeetingExpired(meetingTime) {
    if (!meetingTime) return false;
    const [hours, minutes] = meetingTime.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return false;
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    return currentHours > hours || (currentHours === hours && currentMinutes > minutes);
}

let dataCache = {};
let chatHistory = [];
let activityChart = null;
let portfolioChart = null;
let workloadChart = null;
let burndownChart = null;

// Status pipeline order — tasks can only move forward
const STATUS_ORDER = { todo: 0, in_progress: 1, review: 2, done: 3, blocked: -1 };
const STATUS_COLORS = {
    todo: '#6b7a9e', in_progress: '#6366f1', review: '#f59e0b',
    done: '#10b981', blocked: '#f43f5e'
};
const STATUS_LABELS = {
    todo: 'To Do', in_progress: 'In Progress', review: 'In Review',
    done: 'Done', blocked: 'Blocked'
};

Chart.defaults.color = '#6b7a9e';
Chart.defaults.font.family = "'Outfit', sans-serif";
Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';

// ─── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', e => { e.preventDefault(); switchView(item.dataset.view); });
});
document.querySelectorAll('.panel-link[data-view]').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); switchView(link.dataset.view); });
});

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
    const v = document.getElementById(`view-${viewName}`);
    const n = document.getElementById(`nav-${viewName}`);
    if (v) v.classList.add('active');
    if (n) n.classList.add('active');
    currentView = viewName;
    loadViewData(viewName);
}

function loadViewData(view) {
    switch (view) {
        case 'dashboard':    fetchDashboard(); break;
        case 'projects':     fetchProjects(); break;
        case 'agents':       fetchAgentsFull(); break;
        case 'team':         fetchTeam(); break;
        case 'kanban':       fetchKanban(); break;
        case 'vault':        fetchVault(); break;
        case 'member-dash':  fetchMemberDashboard(); break;
    }
}

// ─── API Helper ───────────────────────────────────────────────────────────────
async function api(endpoint) {
    if (dataCache[endpoint]) return dataCache[endpoint];
    const res = await authFetch(`${API}${endpoint}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    dataCache[endpoint] = data;
    return data;
}

// ─── Vault View ───────────────────────────────────────────────────────────────
async function fetchVault() {
    const projGrid = document.getElementById('vault-projects-grid');
    const teamGrid = document.getElementById('vault-team-grid');
    projGrid.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i></div>';
    teamGrid.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i></div>';
    
    try {
        const [projects, team] = await Promise.all([
            fetch(`${API}/vault/projects`).then(r => r.json()),
            fetch(`${API}/vault/team`).then(r => r.json())
        ]);
        
        if (!projects || projects.length === 0) {
            projGrid.innerHTML = '<div class="loading-state"><i class="ri-archive-drawer-line"></i> No deleted projects</div>';
        } else {
            projGrid.innerHTML = projects.map(p => `
                <div class="project-card glass-panel" style="--project-color:${p.color}; opacity:0.8;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:1rem;">
                        <div class="project-name">${p.name}</div>
                        <button class="btn-primary restore-proj-btn" data-id="${p.id}" style="padding:4px 8px; font-size:0.8rem;"><i class="ri-refresh-line"></i> Restore</button>
                    </div>
                    <div class="project-desc">${p.description}</div>
                    <div class="project-meta" style="margin-top:1rem; font-size:0.75rem;">Deleted: ${p.deleted_at ? new Date(p.deleted_at).toLocaleDateString() : 'Unknown'}</div>
                </div>`).join('');
        }
        
        if (!team || team.length === 0) {
            teamGrid.innerHTML = '<div class="loading-state"><i class="ri-user-unfollow-line"></i> No removed members</div>';
        } else {
            teamGrid.innerHTML = team.map(m => `
                <div class="team-card glass-panel" style="opacity:0.8;">
                    <button class="restore-member-btn" data-name="${m.name}" title="Restore member" style="position:absolute;top:10px;right:10px;background:rgba(16,185,129,0.12);border:none;color:#10b981;border-radius:50%;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.9rem;z-index:2"><i class="ri-refresh-line"></i></button>
                    <div class="team-card-header">
                        <div class="team-member-avatar" style="background:${m.avatar_bg}">${m.name[0]}</div>
                        <div><div class="team-member-name">${m.name}</div><div class="team-member-role">${m.role}</div></div>
                    </div>
                </div>`).join('');
        }
        
        // Add listeners
        document.querySelectorAll('.restore-proj-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                e.currentTarget.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
                await authFetch(`${API}/projects/${encodeURIComponent(id)}/restore`, {method:'POST'});
                dataCache = {};
                fetchVault();
                showToast('Project restored!', 'success', 'ri-refresh-line');
            });
        });
        document.querySelectorAll('.restore-member-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const name = e.currentTarget.dataset.name;
                e.currentTarget.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
                await authFetch(`${API}/team/${encodeURIComponent(name)}/restore`, {method:'POST'});
                dataCache = {};
                fetchVault();
                showToast('Team member restored!', 'success', 'ri-refresh-line');
                
                try {
                    await authFetch(`${API}/notifications`, {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ title: 'Member Restored', message: `${name} was restored to the active team.`, iconClass: 'ri-user-add-line', iconBg: '#10b981', iconColor: 'white', roles: ['admin'] })
                    });
                } catch {}
            });
        });
    } catch {
        projGrid.innerHTML = '<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Failed to load</div>';
        teamGrid.innerHTML = '<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Failed to load</div>';
    }
}

document.getElementById('refresh-btn').addEventListener('click', () => {
    dataCache = {};
    loadViewData(currentView);
    showToast('Data refreshed', 'info', 'ri-refresh-line');
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function fetchDashboard() {
    try {
        const [stats, agents, risks, activity, sprint] = await Promise.all([
            api('/stats'), api('/agents'), api('/risks'), api('/activity'), api('/sprint')
        ]);
        renderKPIs(stats, risks.length);
        updateDashboardSubtitle(stats.active_projects, agents.length);
        renderAgentList(agents);
        renderRiskList(risks);
        renderActivityChart(activity);
        renderPortfolioChart();
        renderBurndownChart(sprint);
        setAIStatus(true);
    } catch (err) {
        setAIStatus(false);
        document.getElementById('kpi-grid').innerHTML =
            `<div class="loading-state text-red" style="grid-column:span 4">
             <i class="ri-error-warning-line"></i> Cannot connect to backend. Is the server running?</div>`;
    }
}

function renderKPIs(stats, riskCount) {
    document.getElementById('kpi-grid').innerHTML = `
        <div class="kpi-card glass-panel" style="cursor:pointer" onclick="switchView('projects')">
            <div class="kpi-header"><span class="kpi-title">Active Projects</span><div class="kpi-icon blue"><i class="ri-folder-open-line"></i></div></div>
            <div class="kpi-value">${stats.active_projects}</div>
            <div class="kpi-trend positive"><i class="ri-arrow-right-line"></i> Click to manage</div>
        </div>
        <div class="kpi-card glass-panel" style="cursor:pointer" onclick="switchView('team')">
            <div class="kpi-header"><span class="kpi-title">Team Capacity</span><div class="kpi-icon green"><i class="ri-battery-charge-line"></i></div></div>
            <div class="kpi-value">${stats.team_capacity}%</div>
            <div class="kpi-trend positive"><i class="ri-arrow-right-line"></i> Click to view</div>
        </div>
        <div class="kpi-card glass-panel" style="cursor:pointer" onclick="switchView('agents')">
            <div class="kpi-header"><span class="kpi-title">Active Risks</span><div class="kpi-icon red"><i class="ri-error-warning-line"></i></div></div>
            <div class="kpi-value">${riskCount}</div>
            <div class="kpi-trend negative"><i class="ri-arrow-right-line"></i> Click to review</div>
        </div>
        <div class="kpi-card glass-panel" style="cursor:pointer" onclick="switchView('kanban')">
            <div class="kpi-header"><span class="kpi-title">Done Today</span><div class="kpi-icon purple"><i class="ri-check-double-line"></i></div></div>
            <div class="kpi-value">${stats.tasks_completed_today}</div>
            <div class="kpi-trend positive"><i class="ri-arrow-right-line"></i> View board</div>
        </div>`;
}

function renderAgentList(agents) {
    document.getElementById('agent-list').innerHTML = agents.slice(0, 3).map(a => `
        <div class="agent-item" style="cursor:pointer" data-agent-id="${a.id}">
            <div class="agent-icon ${a.role}"><i class="${a.icon}"></i></div>
            <div class="agent-info">
                <div class="agent-name">${a.name}</div>
                <div class="agent-task">${a.task}</div>
            </div>
            <div class="agent-status ${a.status === 'Active' ? 'status-active' : ''}">${a.status}</div>
        </div>`).join('');
    document.querySelectorAll('#agent-list .agent-item').forEach(item => {
        item.addEventListener('click', () => openAgentModal(item.dataset.agentId));
    });
}

function renderRiskList(risks) {
    document.getElementById('risk-count').textContent = `${risks.length} risks`;
    document.getElementById('risk-list').innerHTML = risks.map(r => `
        <div class="risk-item ${r.severity}">
            <div class="risk-header"><span class="risk-title">${r.title}</span><span class="risk-time">${r.time}</span></div>
            <div class="risk-desc">${r.desc}</div>
            <button class="risk-action">${r.actionText}</button>
        </div>`).join('');
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function renderActivityChart(activity) {
    const ctx = document.getElementById('activity-chart');
    if (!ctx) return;
    if (activityChart) { activityChart.destroy(); activityChart = null; }
    const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 180);
    grad.addColorStop(0, 'rgba(99,102,241,0.3)');
    grad.addColorStop(1, 'rgba(99,102,241,0)');
    activityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: activity.map(d => d.day),
            datasets: [
                { label:'Completed', data: activity.map(d => d.completed), borderColor:'#6366f1', backgroundColor: grad, tension:0.4, fill:true, pointBackgroundColor:'#6366f1', pointRadius:4 },
                { label:'Added', data: activity.map(d => d.added), borderColor:'#06b6d4', backgroundColor:'transparent', tension:0.4, fill:false, borderDash:[5,3], pointRadius:3 }
            ]
        },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ x:{grid:{display:false}}, y:{grid:{color:'rgba(255,255,255,0.04)'}} } }
    });
}

async function renderPortfolioChart() {
    const ctx = document.getElementById('portfolio-chart');
    if (!ctx) return;
    if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }
    
    let projects = [];
    try { projects = await api('/projects'); } catch {}

    const labels = projects.length ? projects.map(p => p.name.split(' ')[0]) : ['Omega','Atlas','Mercury','Nova'];
    const data   = projects.length ? projects.map(p => p.progress || 0) : [62,81,40,95];
    const colors = ['#6366f1','#10b981','#f59e0b','#06b6d4','#f43f5e','#8b5cf6','#ec4899','#14b8a6'];

    portfolioChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth:0, hoverOffset:6 }] },
        options: { responsive:true, maintainAspectRatio:false, cutout:'72%', plugins:{ legend:{display:false} } }
    });
    document.getElementById('donut-legend').innerHTML = labels.map((l, i) => `
        <div class="legend-item">
            <div class="legend-dot" style="background:${colors[i]}"></div>
            <span class="legend-label">${l}</span>
            <span class="legend-val">${data[i]}%</span>
        </div>`).join('');
}

function renderWorkloadChart(team) {
    const ctx = document.getElementById('workload-chart');
    if (!ctx) return;
    if (workloadChart) { workloadChart.destroy(); workloadChart = null; }
    const colors = ['rgba(99,102,241,0.7)','rgba(6,182,212,0.7)','rgba(244,63,94,0.7)','rgba(16,185,129,0.7)','rgba(245,158,11,0.7)','rgba(139,92,246,0.7)'];
    workloadChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: team.map(m => m.name),
            datasets: [
                { label:'Used', data: team.map(m => m.capacity), backgroundColor: team.map((_, i) => colors[i % colors.length]), borderRadius:6, borderSkipped:false },
                { label:'Available', data: team.map(m => 100 - m.capacity), backgroundColor:'rgba(255,255,255,0.04)', borderRadius:6, borderSkipped:false }
            ]
        },
        options: { indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{stacked:true, max:100, ticks:{callback:v=>v+'%'}, grid:{color:'rgba(255,255,255,0.04)'}}, y:{stacked:true, grid:{display:false}} } }
    });
}

function renderBurndownChart(sprint) {
    const ctx = document.getElementById('burndown-chart');
    if (!ctx) return;
    if (burndownChart) { burndownChart.destroy(); burndownChart = null; }
    document.getElementById('sprint-meta').innerHTML = `
        <div class="sprint-meta-item">Tasks left: <strong>${sprint.remaining}</strong></div>
        <div class="sprint-meta-item">Velocity: <strong>${sprint.velocity} / day</strong></div>
        <div class="sprint-meta-item">Est. Finish: <strong>${sprint.predicted_finish}</strong></div>`;
    const badge = document.getElementById('sprint-prediction-badge');
    badge.className = `project-status-badge ${sprint.on_track ? 'on_track' : 'at_risk'}`;
    badge.innerHTML = sprint.on_track
        ? '<i class="ri-check-line"></i> On Track'
        : '<i class="ri-error-warning-line"></i> At Risk';
    burndownChart = new Chart(ctx, {
        type: 'line',
        data: { labels: sprint.labels, datasets: [
            { label:'Actual', data:sprint.actual_line, borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.1)', fill:true, tension:0.2, pointRadius:4 },
            { label:'Ideal',  data:sprint.ideal_line,  borderColor:'rgba(255,255,255,0.2)', borderDash:[5,5], fill:false, tension:0, pointRadius:0 }
        ]},
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{grid:{display:false}}, y:{beginAtZero:true, grid:{color:'rgba(255,255,255,0.05)'}} } }
    });
}

// ─── Projects View ────────────────────────────────────────────────────────────
// Track which project is currently open in the modal
let currentProjectId = null;

function renderProjectCard(p) {
    return `
        <div class="project-card glass-panel" style="cursor:pointer;--project-color:${p.color}"
             data-project-id="${p.id}" data-project-name="${p.name}" data-project-color="${p.color}">
            <div class="project-status-badge ${p.progress >= 100 ? 'done' : p.status}">${p.progress >= 100 ? '<i class="ri-check-double-line"></i> Completed' : p.status === 'on_track' ? '<i class="ri-check-line"></i> On Track' : '<i class="ri-error-warning-line"></i> At Risk'}</div>
            <div class="project-name">${p.name}</div>
            <div class="project-desc">${p.description}</div>
            <div class="project-progress-bar">
                <div class="project-progress-fill" style="width:${p.progress}%;background:${p.color}"></div>
            </div>
            <div class="project-meta"><span>${p.tasks_done}/${p.tasks_total} tasks · <strong>${p.progress}%</strong></span></div>
            ${p.meeting_details ? `<div style="margin-bottom:1rem; font-size:0.8rem;"><a href="${p.meeting_details}" target="_blank" style="color:var(--accent-secondary); text-decoration:none;"><i class="ri-video-chat-line"></i> Join Meeting</a></div>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem">
                <div class="project-team">
                    ${(p.team||[]).map(n => `<div class="member-avatar" style="background:hsl(${n.charCodeAt(0)*7%360},60%,45%)" title="${n}">${n[0]}</div>`).join('')}
                </div>
                <div class="project-deadline"><i class="ri-calendar-line"></i> ${p.deadline}</div>
            </div>
        </div>`;
}

async function fetchProjects() {
    const activeGrid = document.getElementById('active-projects-grid');
    const completedGrid = document.getElementById('completed-projects-grid');
    activeGrid.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i></div>';
    try {
        const projects = await api('/projects');
        const user = JSON.parse(localStorage.getItem('nexus_user') || '{}');
        const filteredProjects = projects;
        const activeProjects    = filteredProjects.filter(p => p.progress < 100);
        const completedProjects = filteredProjects.filter(p => p.progress >= 100);

        // Update subtitle
        const sub = document.querySelector('#view-projects .subtitle strong');
        if (sub) sub.textContent = `${activeProjects.length} active projects`;
        // Update kanban filter options (feature 1: sync everywhere)
        syncProjectDropdowns(projects);

        // Render Active projects
        if (activeProjects.length) {
            activeGrid.innerHTML = activeProjects.map(renderProjectCard).join('');
        } else {
            activeGrid.innerHTML = '<div class="loading-state" style="color:var(--text-secondary)">No active projects. Create one!</div>';
        }

        // Render Completed projects
        if (completedProjects.length) {
            completedGrid.innerHTML = completedProjects.map(renderProjectCard).join('');
        } else {
            completedGrid.innerHTML = '<div class="loading-state" style="color:var(--text-secondary);font-size:0.85rem">No completed projects yet.</div>';
        }

        // Bind click events to both grids
        [activeGrid, completedGrid].forEach(grid => {
            grid.querySelectorAll('.project-card').forEach(card => {
                card.addEventListener('click', () => openProjectModal(card.dataset.projectId, card.dataset.projectName, card.dataset.projectColor));
            });
        });
    } catch {
        activeGrid.innerHTML = `<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Failed to load projects.</div>`;
    }
}

// Feature 1: sync project names to ALL dropdowns
function syncProjectDropdowns(projects) {
    const projectNames = projects.map(p => p.name);
    // Kanban filter
    const kanbanFilter = document.getElementById('kanban-filter');
    if (kanbanFilter) {
        kanbanFilter.innerHTML = `<option value="all">All Projects</option>` +
            projectNames.map(n => `<option value="${n}">${n}</option>`).join('');
    }
    // Quick-add project dropdown
    const qaProject = document.getElementById('qa-project');
    if (qaProject) {
        qaProject.innerHTML = projectNames.map(n => `<option>${n}</option>`).join('');
    }
    // Update portfolio chart
    if (portfolioChart) { renderPortfolioChart(); }
}

// ─── Agents View ──────────────────────────────────────────────────────────────
async function fetchAgentsFull() {
    const grid = document.getElementById('agents-full-grid');
    grid.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i></div>';
    try {
        const agents = await api('/agents');
        const roleLabels = { planner:'Strategic Planning', sentinel:'Risk Monitoring', executor:'Task Automation', scribe:'Meeting Intelligence' };
        grid.innerHTML = agents.map(a => `
            <div class="agent-card glass-panel" style="cursor:pointer" data-agent-id="${a.id}">
                <div class="agent-card-header">
                    <div class="agent-card-icon ${a.role}"><i class="${a.icon}"></i></div>
                    <div><div class="agent-card-name">${a.name}</div><div class="agent-card-role">${roleLabels[a.role]||a.role}</div></div>
                    <div class="agent-status ${a.status==='Active'?'status-active':''}" style="margin-left:auto">${a.status}</div>
                </div>
                <div class="agent-card-task">${a.task}</div>
                <div class="agent-card-last"><i class="ri-time-line"></i> Last action: ${a.last_action}</div>
            </div>`).join('');
        grid.querySelectorAll('.agent-card').forEach(card => {
            card.addEventListener('click', () => openAgentModal(card.dataset.agentId));
        });
    } catch {
        grid.innerHTML = `<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Failed to load agents.</div>`;
    }
}

// ─── Team View ────────────────────────────────────────────────────────────────
async function fetchTeam() {
    const grid = document.getElementById('team-grid');
    grid.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i></div>';
    try {
        const team = await api('/team');
        const statusMap = {
            overloaded: { label:'<i class="ri-alert-line"></i> Overloaded', cls:'chip-overloaded' },
            healthy:    { label:'<i class="ri-heart-pulse-line"></i> Healthy',    cls:'chip-healthy' },
            pto_friday: { label:'<i class="ri-plane-line"></i> PTO Friday', cls:'chip-pto' },
        };
        grid.innerHTML = team.map(m => {
            const s = statusMap[m.status] || statusMap.healthy;
            const barCls = m.status === 'overloaded' ? 'overloaded' : m.status === 'pto_friday' ? 'pto' : 'healthy';
            return `
            <div class="team-card glass-panel" style="cursor:pointer;position:relative" data-member-name="${m.name}">
                <button class="remove-member-btn" data-member-name="${m.name}" title="Remove member" style="position:absolute;top:10px;right:10px;background:rgba(244,63,94,0.12);border:none;color:#f43f5e;border-radius:50%;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.9rem;z-index:2"><i class="ri-user-unfollow-line"></i></button>
                <div class="team-card-header">
                    <div class="team-member-avatar" style="background:${m.avatar_bg}">${m.name[0]}</div>
                    <div><div class="team-member-name">${m.name}</div><div class="team-member-role">${m.role}</div></div>
                </div>
                <div class="capacity-label"><span>Capacity Used</span><span>${m.capacity}%</span></div>
                <div class="capacity-bar"><div class="capacity-fill ${barCls}" style="width:${m.capacity}%"></div></div>
                <div class="team-stats">
                    <div class="team-stat"><div class="team-stat-label">Active Tasks</div><div class="team-stat-value">${m.tasks}</div></div>
                    <div class="team-stat"><div class="team-stat-label">Available</div><div class="team-stat-value">${100-m.capacity}%</div></div>
                </div>
                <div class="team-status-chip ${s.cls}">${s.label}</div>
            </div>`;
        }).join('');

        // Click card → open modal (but not the remove button)
        grid.querySelectorAll('.team-card').forEach(card => {
            card.addEventListener('click', e => {
                if (e.target.closest('.remove-member-btn')) return;
                openTeamModal(card.dataset.memberName);
            });
        });

        // Remove member buttons
        grid.querySelectorAll('.remove-member-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                confirmRemoveMember(btn.dataset.memberName);
            });
        });

        // Also sync the assignee dropdown in quick-add
        const qaAssignee = document.getElementById('qa-assignee');
        if (qaAssignee) {
            qaAssignee.innerHTML = team.map(m => `<option>${m.name}</option>`).join('');
        }

        renderWorkloadChart(team);
    } catch {
        grid.innerHTML = `<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Failed to load team.</div>`;
    }
}

// Feature 2: confirm & remove member (soft-delete keeps history)
async function confirmRemoveMember(memberName) {
    const confirmed = await showConfirmModal(
        `Remove "${memberName}" from the active team?`, 
        `Their task history will be preserved.`,
        'Team Management'
    );
    if (!confirmed) return;
    removeMember(memberName);
}

async function removeMember(memberName) {
    try {
        const res = await authFetch(`${API}/team/${encodeURIComponent(memberName)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        dataCache = {};
        fetchTeam();
        showToast(`${memberName} removed. History preserved.`, 'info', 'ri-user-unfollow-line');
    } catch {
        showToast('Failed to remove member', 'error', 'ri-error-warning-line');
    }
}

// ─── Add Team Member Modal ────────────────────────────────────────────────────
document.getElementById('btn-add-member').addEventListener('click', () => {
    document.getElementById('add-member-modal-overlay').classList.remove('hidden');
});
document.getElementById('add-member-close').addEventListener('click', () => {
    document.getElementById('add-member-modal-overlay').classList.add('hidden');
});
document.getElementById('add-member-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

// Feature 3: Add new member via UI
const amEyeBtn = document.getElementById('am-eye-btn');
if (amEyeBtn) {
    amEyeBtn.addEventListener('click', () => {
        const input = document.getElementById('am-password');
        const icon = document.getElementById('am-eye-icon');
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'ri-eye-line';
        } else {
            input.type = 'password';
            icon.className = 'ri-eye-off-line';
        }
    });
}

document.getElementById('am-submit').addEventListener('click', async () => {
    const name = document.getElementById('am-name').value.trim();
    const role = document.getElementById('am-role').value.trim();
    const email = document.getElementById('am-email').value.trim();
    const password = document.getElementById('am-password').value;
    const position = document.getElementById('am-position').value;
    const avatar_bg = document.getElementById('am-color').value;
    if (!name || !role || !email || !password) { showToast('Please fill in all required fields', 'error', 'ri-error-warning-line'); return; }

    // Check if email already registered
    let usersDB = JSON.parse(localStorage.getItem('nexus_usersDB')) || [];
    if (usersDB.find(u => u.email === email)) {
        showToast('A user with this email already exists.', 'error', 'ri-error-warning-line');
        return;
    }

    const btn = document.getElementById('am-submit');
    btn.textContent = 'Adding...'; btn.disabled = true;
    try {
        const res = await authFetch(`${API}/team`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, role, email, password, position, avatar_bg })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.error || 'A user with this email already exists in backend.', 'error', 'ri-error-warning-line');
            btn.innerHTML = '<i class="ri-user-add-line"></i> Add Member'; btn.disabled = false;
            return;
        }

        // Save credentials locally after successful backend sync
        usersDB.push({ name, email, password, position });
        localStorage.setItem('nexus_usersDB', JSON.stringify(usersDB));

        document.getElementById('add-member-modal-overlay').classList.add('hidden');
        document.getElementById('am-name').value = '';
        document.getElementById('am-role').value = '';
        document.getElementById('am-email').value = '';
        document.getElementById('am-password').value = '';
        dataCache = {};
        fetchTeam();
        showToast(`${name} added! They can now log in with ${email}`, 'success', 'ri-user-add-line');
        // Admin-only notification: new member added
        postNotification('New Member Added', `${name} (${email}) has been added as ${position === 'admin' ? 'Admin' : 'Team Member'}.`, 'ri-user-add-line', 'rgba(99,102,241,0.15)', '#6366f1', ['admin']);
    } catch {
        showToast(`${name} added locally. Backend sync pending.`, 'info', 'ri-user-add-line');
        document.getElementById('add-member-modal-overlay').classList.add('hidden');
        document.getElementById('am-name').value = '';
        document.getElementById('am-role').value = '';
        document.getElementById('am-email').value = '';
        document.getElementById('am-password').value = '';
    } finally {
        btn.innerHTML = '<i class="ri-user-add-line"></i> Add Member'; btn.disabled = false;
    }
});

// ─── Project Detail Modal ─────────────────────────────────────────────────────
async function openProjectModal(projectId, projectName, color) {
    currentProjectId = projectId;  // store for delete button
    const projects = await api('/projects');
    const p = projects.find(proj => proj.id === projectId);
    if (!p) return;

    document.getElementById('modal-project-name').textContent = p.name;
    document.getElementById('modal-project-desc').textContent = p.description;
    const statusHtml = p.progress >= 100
        ? '<i class="ri-check-double-line"></i> Completed'
        : p.status === 'on_track' ? '<i class="ri-check-line"></i> On Track' : '<i class="ri-error-warning-line"></i> At Risk';
    document.getElementById('modal-project-status-badge').innerHTML = statusHtml;
    document.getElementById('modal-progress-val').textContent = p.progress + '%';
    document.getElementById('modal-tasks-val').textContent = `${p.tasks_done}/${p.tasks_total}`;
    document.getElementById('modal-deadline-val').textContent = p.deadline;
    document.getElementById('modal-progress-fill').style.cssText = `width:${p.progress}%;background:${color || p.color}`;

    // Show meeting details section if available
    const meetingContainer = document.getElementById('modal-meeting-container');
    const meetingTimeEl = document.getElementById('modal-meeting-time');
    const meetingLinkEl = document.getElementById('modal-meeting-link');
    if (p.meeting_details || p.meeting_time) {
        meetingContainer.style.display = 'block';
        meetingTimeEl.textContent = p.meeting_time ? `${p.meeting_time}` : 'Time not set';
        meetingTimeEl.innerHTML = p.meeting_time ? `<i class="ri-time-line"></i> ${p.meeting_time}` : '<i class="ri-time-line"></i> Time not set';
        
        const expired = isMeetingExpired(p.meeting_time);
        if (expired && p.meeting_time) {
            meetingLinkEl.style.display = 'inline-flex';
            meetingLinkEl.href = '#';
            meetingLinkEl.textContent = 'Meeting Expired';
            meetingLinkEl.style.background = 'rgba(255,255,255,0.05)';
            meetingLinkEl.style.color = '#6b7a9e';
            meetingLinkEl.style.pointerEvents = 'none';
        } else {
            meetingLinkEl.href = p.meeting_details || '#';
            meetingLinkEl.style.display = p.meeting_details ? 'inline-flex' : 'none';
            meetingLinkEl.textContent = 'Join Link';
            meetingLinkEl.style.background = 'rgba(99,102,241,0.12)';
            meetingLinkEl.style.color = '#6366f1';
            meetingLinkEl.style.pointerEvents = 'auto';
        }
    } else {
        meetingContainer.style.display = 'none';
    }

    const taskList = document.getElementById('modal-task-list');
    taskList.innerHTML = '<div class="loading-state" style="padding:1rem"><i class="ri-loader-4-line ri-spin"></i></div>';
    document.getElementById('project-modal-overlay').classList.remove('hidden');

    try {
        const res = await authFetch(`${API}/tasks?project=${encodeURIComponent(p.name)}`);
        const tasks = await res.json();
        taskList.innerHTML = tasks.length ? tasks.map(t => `
            <div class="task-item">
                <div class="task-priority-dot priority-${t.priority}"></div>
                <span class="task-title">${t.title}</span>
                <span class="task-assignee">${t.assignee}</span>
                <span class="task-status-badge ${t.status}" style="background:${STATUS_COLORS[t.status]}22;color:${STATUS_COLORS[t.status]}">${STATUS_LABELS[t.status]||t.status}</span>
            </div>`).join('')
        : '<div class="loading-state" style="padding:1rem;color:var(--text-secondary)">No tasks yet</div>';
    } catch {
        taskList.innerHTML = '<div class="loading-state text-red" style="padding:1rem">Failed to load tasks</div>';
    }
}

document.getElementById('project-modal-close').addEventListener('click', () => {
    document.getElementById('project-modal-overlay').classList.add('hidden');
    currentProjectId = null;
});
document.getElementById('project-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) { e.currentTarget.classList.add('hidden'); currentProjectId = null; }
});

// ─── Edit Project Details ─────────────────────────────────────────────────────
document.getElementById('edit-project-btn').addEventListener('click', async () => {
    const panel = document.getElementById('modal-edit-panel');
    const isHidden = panel.style.display === 'none' || panel.style.display === '';
    if (isHidden) {
        // Pre-fill current values
        if (!currentProjectId) return;
        const projects = await api('/projects');
        const p = projects.find(proj => proj.id === currentProjectId);
        if (p) {
            document.getElementById('edit-deadline-input').value = p.deadline !== 'TBD' ? p.deadline : '';
            document.getElementById('edit-meeting-time-input').value = p.meeting_time || '';
            document.getElementById('edit-meeting-link-input').value = p.meeting_details || '';
        }
        panel.style.display = 'block';
        document.getElementById('edit-project-btn').style.color = '#f59e0b';
    } else {
        panel.style.display = 'none';
        document.getElementById('edit-project-btn').style.color = '#38bdf8';
    }
});

document.getElementById('save-project-edits-btn').addEventListener('click', async () => {
    if (!currentProjectId) return;
    const deadline = document.getElementById('edit-deadline-input').value.trim() || 'TBD';
    const meeting_time = document.getElementById('edit-meeting-time-input').value.trim();
    const meeting_details = document.getElementById('edit-meeting-link-input').value.trim();
    const btn = document.getElementById('save-project-edits-btn');
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Saving...'; btn.disabled = true;
    try {
        const res = await authFetch(`${API}/projects/${encodeURIComponent(currentProjectId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deadline, meeting_time, meeting_details })
        });
        if (!res.ok) throw new Error();
        dataCache = {};
        // Update displayed values immediately
        document.getElementById('modal-deadline-val').textContent = deadline;
        document.getElementById('modal-meeting-time').innerHTML = meeting_time ? `<i class="ri-time-line"></i> ${meeting_time}` : '<i class="ri-time-line"></i> Time not set';
        const linkEl = document.getElementById('modal-meeting-link');
        linkEl.href = meeting_details || '#';
        linkEl.style.display = meeting_details ? 'inline-flex' : 'none';
        document.getElementById('modal-meeting-container').style.display = (meeting_details || meeting_time) ? 'block' : 'none';
        document.getElementById('modal-edit-panel').style.display = 'none';
        document.getElementById('edit-project-btn').style.color = '#38bdf8';
        showToast('Project updated!', 'success', 'ri-save-line');
    } catch {
        showToast('Failed to save changes', 'error', 'ri-error-warning-line');
    } finally {
        btn.innerHTML = '<i class="ri-save-line"></i> Save Changes'; btn.disabled = false;
    }
});

// Delete Project Button
document.getElementById('delete-project-btn').addEventListener('click', async () => {
    if (!currentProjectId) return;
    const projectName = document.getElementById('modal-project-name').textContent;
    const confirmed = await showConfirmModal(
        `Move "${projectName}" to Vault?`,
        `The project will be soft-deleted and stored in the Vault for 90 days before permanent removal.`,
        'Project Management'
    );
    if (!confirmed) return;

    const btn = document.getElementById('delete-project-btn');
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>'; btn.disabled = true;
    try {
        const res = await authFetch(`${API}/projects/${encodeURIComponent(currentProjectId)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        document.getElementById('project-modal-overlay').classList.add('hidden');
        dataCache = {};
        await fetchProjects();
        showToast(`"${projectName}" moved to Vault.`, 'info', 'ri-archive-line');
    } catch {
        showToast('Failed to delete project', 'error', 'ri-error-warning-line');
    } finally {
        btn.innerHTML = '<i class="ri-delete-bin-line"></i>'; btn.disabled = false;
    }
});

// ─── Project Report ───────────────────────────────────────────────────────────
document.getElementById('report-project-btn').addEventListener('click', async () => {
    if (!currentProjectId) return;
    const overlay = document.getElementById('proj-report-modal-overlay');
    const body = document.getElementById('proj-report-body');
    const titleEl = document.getElementById('proj-report-title');
    overlay.classList.remove('hidden');
    body.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i> Generating report...</div>';

    try {
        const projects = await api('/projects');
        const p = projects.find(proj => proj.id === currentProjectId);
        if (!p) throw new Error('Project not found');

        const taskRes = await authFetch(`${API}/tasks?project=${encodeURIComponent(p.name)}`);
        const tasks = await taskRes.json();

        const statusCounts = { todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
        tasks.forEach(t => { if (statusCounts[t.status] !== undefined) statusCounts[t.status]++; });

        titleEl.textContent = `${p.name} — Report`;
        const now = new Date().toLocaleString();
        const reportHTML = `
            <div style="border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:1rem;margin-bottom:1.5rem;">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <div><div style="font-size:0.75rem;color:#6b7a9e;text-transform:uppercase;">Project</div><div style="font-size:1.1rem;font-weight:700;color:#f0f4ff;">${p.name}</div></div>
                    <div><div style="font-size:0.75rem;color:#6b7a9e;text-transform:uppercase;">Generated</div><div style="font-size:0.9rem;color:#8892b0;">${now}</div></div>
                </div>
                <p style="margin-top:0.75rem;color:#8892b0;">${p.description}</p>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:1.5rem;">
                <div style="background:rgba(99,102,241,0.12);border-radius:10px;padding:0.85rem;text-align:center;"><div style="font-size:1.6rem;font-weight:700;color:#6366f1;">${p.progress}%</div><div style="font-size:0.75rem;color:#6b7a9e;">Progress</div></div>
                <div style="background:rgba(16,185,129,0.12);border-radius:10px;padding:0.85rem;text-align:center;"><div style="font-size:1.6rem;font-weight:700;color:#10b981;">${p.tasks_done}/${p.tasks_total}</div><div style="font-size:0.75rem;color:#6b7a9e;">Tasks Done</div></div>
                <div style="background:rgba(245,158,11,0.12);border-radius:10px;padding:0.85rem;text-align:center;"><div style="font-size:1.1rem;font-weight:700;color:#f59e0b;">${p.deadline}</div><div style="font-size:0.75rem;color:#6b7a9e;">Deadline</div></div>
            </div>
            <div style="margin-bottom:1.5rem;">
                <div style="font-size:0.75rem;color:#6b7a9e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Task Breakdown</div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${Object.entries(statusCounts).map(([k,v]) => `<span style="background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:6px;font-size:0.82rem;">${STATUS_LABELS[k]||k}: <strong>${v}</strong></span>`).join('')}
                </div>
            </div>
            ${p.meeting_time ? `<div style="margin-bottom:1.5rem;"><div style="font-size:0.75rem;color:#6b7a9e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Meeting</div><div style="color:#f0f4ff;"><i class="ri-time-line" style="margin-right:4px"></i>${p.meeting_time}${p.meeting_details ? (isMeetingExpired(p.meeting_time) ? ` &mdash; <span style="color:#6b7a9e;">(Meeting Expired)</span>` : ` &mdash; <a href="${p.meeting_details}" target="_blank" style="color:#6366f1;">Join Link &#8599;</a>`) : ''}</div></div>` : ''}
            <div>
                <div style="font-size:0.75rem;color:#6b7a9e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Team Members</div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">${(p.team||[]).map(n=>`<span style="background:hsl(${n.charCodeAt(0)*7%360},50%,20%);color:hsl(${n.charCodeAt(0)*7%360},70%,75%);padding:4px 12px;border-radius:20px;font-size:0.82rem;">${n}</span>`).join('')}</div>
            </div>
            ${tasks.length ? `<div style="margin-top:1.5rem;"><div style="font-size:0.75rem;color:#6b7a9e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">All Tasks</div><div style="display:flex;flex-direction:column;gap:6px;">${tasks.map(t=>`<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;"><span>${t.title}</span><div style="display:flex;gap:8px;align-items:center;"><span style="color:#6b7a9e;">${t.assignee}</span><span style="background:${STATUS_COLORS[t.status]}22;color:${STATUS_COLORS[t.status]};padding:2px 8px;border-radius:4px;font-size:0.75rem;">${STATUS_LABELS[t.status]||t.status}</span></div></div>`).join('')}</div></div>` : ''}
        `;
        body.innerHTML = reportHTML;
        // Store data for download
        body.dataset.projectName = p.name;
        body.dataset.reportHTML = reportHTML;
    } catch {
        body.innerHTML = '<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Failed to generate report</div>';
    }
});

document.getElementById('proj-report-close').addEventListener('click', () => {
    document.getElementById('proj-report-modal-overlay').classList.add('hidden');
});
document.getElementById('proj-report-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('proj-report-download-btn').addEventListener('click', () => {
    const body = document.getElementById('proj-report-body');
    const name = body.dataset.projectName || 'Project';
    const content = body.innerHTML;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${name} Report</title><style>body{font-family:system-ui,sans-serif;background:#0f1224;color:#f0f4ff;padding:2rem;max-width:800px;margin:0 auto;}a{color:#6366f1;}strong{color:#fff;}</style></head><body><h1>${name} — Project Report</h1>${content}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${name.replace(/\s+/g,'-')}-Report.html`; a.click();
    URL.revokeObjectURL(url);
    showToast('Report downloaded!', 'success', 'ri-download-line');
});


// ─── New Project Modal ────────────────────────────────────────────────────────
document.getElementById('btn-new-project').addEventListener('click', () => {
    document.getElementById('new-project-modal-overlay').classList.remove('hidden');
});
document.getElementById('new-project-close').addEventListener('click', () => {
    document.getElementById('new-project-modal-overlay').classList.add('hidden');
});
document.getElementById('new-project-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('np-submit').addEventListener('click', async () => {
    const name = document.getElementById('np-name').value.trim();
    const description = document.getElementById('np-desc').value.trim() || 'No description';
    const color = document.getElementById('np-color').value;
    const deadline = document.getElementById('np-deadline').value.trim() || 'TBD';
    const meeting_details = document.getElementById('np-meeting').value.trim();
    const meeting_time = document.getElementById('np-meeting-time').value.trim();
    if (!name) { showToast('Please enter a project name', 'error', 'ri-error-warning-line'); return; }

    const btn = document.getElementById('np-submit');
    btn.textContent = 'Creating...'; btn.disabled = true;
    try {
        const res = await authFetch(`${API}/projects`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, color, deadline, meeting_details, meeting_time })
        });
        if (!res.ok) throw new Error();
        document.getElementById('new-project-modal-overlay').classList.add('hidden');
        document.getElementById('np-name').value = '';
        document.getElementById('np-desc').value = '';
        document.getElementById('np-meeting').value = '';
        document.getElementById('np-meeting-time').value = '';
        dataCache = {};
        // Feature 1: refresh projects then sync everywhere
        await fetchProjects();
        // Also refresh portfolio if on dashboard
        if (currentView === 'dashboard') renderPortfolioChart();
        showToast(`"${name}" created!`, 'success', 'ri-folder-add-line');
        postNotification('Project Added', `"${name}" has been created.`, 'ri-folder-add-line', 'rgba(99,102,241,0.15)', '#6366f1', ['all']);
    } catch {
        showToast('Failed to create project', 'error', 'ri-error-warning-line');
    } finally {
        btn.textContent = 'Create Project'; btn.disabled = false;
    }
});

// ─── Agent Modal ──────────────────────────────────────────────────────────────
async function openAgentModal(agentId) {
    const agents = await api('/agents');
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    const roleLabels = { planner:'Strategic Planning', sentinel:'Risk Monitoring', executor:'Task Automation', scribe:'Meeting Intelligence' };
    document.getElementById('agent-modal-icon').className = `agent-card-icon ${agent.role}`;
    document.getElementById('agent-modal-icon').innerHTML = `<i class="${agent.icon}"></i>`;
    document.getElementById('agent-modal-name').textContent = agent.name;
    document.getElementById('agent-modal-role').textContent = roleLabels[agent.role] || agent.role;
    document.getElementById('agent-modal-task').textContent = agent.task;
    document.getElementById('agent-modal-last').innerHTML = `<i class="ri-time-line"></i> ${agent.last_action}`;
    document.getElementById('agent-modal-overlay').classList.remove('hidden');
}

document.getElementById('agent-modal-close').addEventListener('click', () => {
    document.getElementById('agent-modal-overlay').classList.add('hidden');
});
document.getElementById('agent-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

// ─── Team Member Modal (Feature 3: full task status view) ─────────────────────
async function openTeamModal(memberName) {
    const teamData = await api('/team');
    const member = teamData.find(m => m.name === memberName);
    if (!member) return;

    document.getElementById('team-modal-avatar').textContent = member.name[0];
    document.getElementById('team-modal-avatar').style.background = member.avatar_bg;
    document.getElementById('team-modal-name').textContent = member.name;
    document.getElementById('team-modal-role').textContent = member.role;
    document.getElementById('team-modal-capacity').textContent = `${member.capacity}%`;
    document.getElementById('team-modal-taskcount').textContent = member.tasks;
    const statusLabels = {
        overloaded: '<i class="ri-alert-line"></i> Overloaded',
        healthy: '<i class="ri-heart-pulse-line"></i> Healthy',
        pto_friday: '<i class="ri-plane-line"></i> PTO Friday'
    };
    document.getElementById('team-modal-status').innerHTML = statusLabels[member.status] || '<i class="ri-heart-pulse-line"></i> Healthy';

    document.getElementById('team-modal-tasks').innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i></div>';
    document.getElementById('team-modal-status-bar').innerHTML = '';
    document.getElementById('team-modal-status-legend').innerHTML = '';
    document.getElementById('team-modal-overlay').classList.remove('hidden');

    try {
        // Bypass cache for fresh task data
        const res = await authFetch(`${API}/tasks`);
        const allTasks = await res.json();
        const memberTasks = allTasks.filter(t => t.assignee === member.name);

        // Build status breakdown bar + legend
        const counts = {};
        memberTasks.forEach(t => { counts[t.status] = (counts[t.status]||0) + 1; });
        const total = memberTasks.length || 1;

        document.getElementById('team-modal-status-bar').innerHTML =
            Object.entries(counts).map(([s, c]) =>
                `<div style="background:${STATUS_COLORS[s]};flex:${c};border-radius:2px" title="${STATUS_LABELS[s]}: ${c}"></div>`
            ).join('');
        document.getElementById('team-modal-status-legend').innerHTML =
            Object.entries(counts).map(([s, c]) =>
                `<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${STATUS_COLORS[s]};margin-right:4px"></span>${STATUS_LABELS[s]}: <strong>${c}</strong></span>`
            ).join('');

        // Task list grouped by status
        if (memberTasks.length === 0) {
            document.getElementById('team-modal-tasks').innerHTML = '<div style="color:#6b7a9e;text-align:center;padding:20px">No tasks assigned.</div>';
            return;
        }

        const grouped = {};
        memberTasks.forEach(t => { (grouped[t.status] = grouped[t.status]||[]).push(t); });
        const order = ['in_progress','review','blocked','todo','done'];

        document.getElementById('team-modal-tasks').innerHTML = order
            .filter(s => grouped[s])
            .map(s => `
                <div style="margin-bottom:14px">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                        <span style="width:8px;height:8px;border-radius:50%;background:${STATUS_COLORS[s]};display:inline-block"></span>
                        <span style="font-size:0.78rem;font-weight:600;color:#6b7a9e;text-transform:uppercase;letter-spacing:.05em">${STATUS_LABELS[s]} (${grouped[s].length})</span>
                    </div>
                    ${grouped[s].map(t => `
                        <div class="task-card" style="margin-bottom:8px">
                            <div class="task-title">${t.title}</div>
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                                <span style="font-size:0.8rem;padding:2px 8px;border-radius:4px;background:${STATUS_COLORS[t.status]}22;color:${STATUS_COLORS[t.status]}">${t.project}</span>
                                <div style="display:flex;align-items:center;gap:8px">
                                    <span style="font-size:0.75rem;padding:2px 6px;border-radius:3px;background:rgba(255,255,255,0.06);color:#6b7a9e;text-transform:capitalize">${t.priority}</span>
                                    <div style="font-size:0.8rem;color:#6b7a9e"><i class="ri-calendar-line"></i> ${t.deadline}</div>
                                </div>
                            </div>
                        </div>`).join('')}
                </div>`).join('');
    } catch {
        document.getElementById('team-modal-tasks').innerHTML = '<div style="color:#f43f5e;text-align:center;padding:20px">Failed to load tasks.</div>';
    }
}

document.getElementById('team-modal-close').addEventListener('click', () => {
    document.getElementById('team-modal-overlay').classList.add('hidden');
});
document.getElementById('team-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('team-modal-name').style.cursor = 'pointer';
document.getElementById('team-modal-name').addEventListener('click', () => {
    document.getElementById('team-modal-edit-btn').click();
});

document.getElementById('me-eye-btn').addEventListener('click', () => {
    const input = document.getElementById('me-password');
    const icon = document.getElementById('me-eye-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'ri-eye-line';
    } else {
        input.type = 'password';
        icon.className = 'ri-eye-off-line';
    }
});

// Edit Profile button opens member edit modal
document.getElementById('team-modal-edit-btn').addEventListener('click', () => {
    const name = document.getElementById('team-modal-name').textContent;
    const role = document.getElementById('team-modal-role').textContent;
    const usersDB = JSON.parse(localStorage.getItem('nexus_usersDB')) || [];
    const user = usersDB.find(u => u.name === name);
    document.getElementById('me-name').value = name;
    document.getElementById('me-role').value = role;
    document.getElementById('me-email').value = user ? user.email : '';
    document.getElementById('me-password').value = user ? user.password : '';
    document.getElementById('me-position').value = user ? (user.position || 'member') : 'member';
    document.getElementById('me-original-email').value = user ? user.email : '';
    document.getElementById('team-modal-overlay').classList.add('hidden');
    document.getElementById('member-edit-modal-overlay').classList.remove('hidden');
});

document.getElementById('member-edit-close').addEventListener('click', () => {
    document.getElementById('member-edit-modal-overlay').classList.add('hidden');
});
document.getElementById('member-edit-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('me-submit').addEventListener('click', async () => {
    const name = document.getElementById('me-name').value.trim();
    const email = document.getElementById('me-email').value.trim();
    const password = document.getElementById('me-password').value.trim();
    const role = document.getElementById('me-role').value.trim();
    const position = document.getElementById('me-position').value;
    const originalEmail = document.getElementById('me-original-email').value;

    if (!name || !email || !password || !role) {
        showToast('Please fill in all fields.', 'error', 'ri-error-warning-line');
        return;
    }

    // Check duplicate email (only if email changed)
    let usersDB = JSON.parse(localStorage.getItem('nexus_usersDB')) || [];
    if (email !== originalEmail && usersDB.find(u => u.email === email)) {
        showToast('That email is already in use by another member.', 'error', 'ri-error-warning-line');
        return;
    }

    // Update usersDB
    const idx = usersDB.findIndex(u => u.email === originalEmail);
    if (idx !== -1) {
        usersDB[idx] = { ...usersDB[idx], name, email, password, position };
    } else {
        usersDB.push({ name, email, password, position });
    }
    localStorage.setItem('nexus_usersDB', JSON.stringify(usersDB));

    // Update backend team member role/name via API
    try {
        await authFetch(`${API}/team/${encodeURIComponent(originalEmail || name)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, role, position, password })
        });
    } catch {}

    document.getElementById('member-edit-modal-overlay').classList.add('hidden');
    dataCache = {};
    fetchTeam();
    showToast(`Profile for ${name} updated successfully.`, 'success', 'ri-user-settings-line');
});


// ─── Report Modal ─────────────────────────────────────────────────────────────
async function openReportModal() {
    const overlay = document.getElementById('report-modal-overlay');
    const body = document.getElementById('report-body');
    overlay.classList.remove('hidden');
    body.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i> Generating report...</div>';
    try {
        const data = await (await authFetch(`${API}/report`)).json();
        const s = data.summary;
        body.innerHTML = `
            <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:1.5rem">${data.generated_at} · ${data.period}</p>
            <div class="report-section">
                <div class="report-section-title">Sprint Overview</div>
                <div class="report-kpi-row">
                    <div class="report-kpi"><div class="report-kpi-label">On Track</div><div class="report-kpi-value text-green">${s.projects_on_track}</div></div>
                    <div class="report-kpi"><div class="report-kpi-label">At Risk</div><div class="report-kpi-value text-yellow">${s.projects_at_risk}</div></div>
                    <div class="report-kpi"><div class="report-kpi-label">Velocity</div><div class="report-kpi-value text-accent">${s.velocity}</div></div>
                </div>
            </div>
            <div class="report-section">
                <div class="report-section-title">Key Highlights</div>
                <div class="report-list">${data.highlights.map(h=>`<div class="report-list-item"><i class="ri-arrow-right-s-line"></i>${h}</div>`).join('')}</div>
            </div>
            <div class="report-section">
                <div class="report-section-title">Upcoming Deadlines</div>
                ${data.upcoming_deadlines.map(d=>`<div class="report-deadline-item"><span>${d.name}</span><span class="${d.status==='on_track'?'text-green':'text-yellow'}">${d.date} · ${d.status==='on_track'?'✅':'⚠️'} ${d.status.replace('_',' ')}</span></div>`).join('')}
            </div>
            <div class="report-section">
                <div class="report-section-title">Active Risks</div>
                <div class="report-list">${data.top_risks.map(r=>`<div class="report-list-item"><i class="ri-error-warning-line text-red"></i>${r}</div>`).join('')}</div>
            </div>`;
    } catch {
        body.innerHTML = `<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Failed.</div>`;
    }
}

document.getElementById('report-modal-close').addEventListener('click', () => { document.getElementById('report-modal-overlay').classList.add('hidden'); });
document.getElementById('report-modal-overlay').addEventListener('click', e => { if (e.target===e.currentTarget) e.currentTarget.classList.add('hidden'); });
document.getElementById('report-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('report-body').innerText)
        .then(() => showToast('Copied to clipboard', 'success', 'ri-clipboard-line'));
});
document.getElementById('btn-new-report').addEventListener('click', openReportModal);

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type='info', icon='ri-information-line') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="${icon}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation='toastOut 0.3s ease forwards'; setTimeout(()=>toast.remove(),300); }, 3500);
}

// ─── Generic Confirm Modal ───────────────────────────────────────────────────
function showConfirmModal(title, message, eyebrow = 'Confirm Action') {
    return new Promise(resolve => {
        const overlay = document.getElementById('generic-confirm-overlay');
        document.getElementById('generic-confirm-eyebrow').textContent = eyebrow;
        document.getElementById('generic-confirm-title').textContent = title;
        document.getElementById('generic-confirm-message').innerHTML = message.replace(/\n/g, '<br><br>');
        
        const okBtn = document.getElementById('generic-confirm-ok');
        const cancelBtn = document.getElementById('generic-confirm-cancel');
        const closeBtn = document.getElementById('generic-confirm-close');

        const cleanup = (result) => {
            overlay.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
            resolve(result);
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);

        overlay.classList.remove('hidden');
    });
}

// ─── AI Status ────────────────────────────────────────────────────────────────
function setAIStatus(online) {
    document.getElementById('ai-status-dot').classList.toggle('online', online);
    document.getElementById('ai-status-text').textContent = online ? 'Nexus Online' : 'Backend Offline';
}

// ─── Chat Widget ──────────────────────────────────────────────────────────────
const chatPanel = document.getElementById('chat-panel');
document.getElementById('chat-toggle').addEventListener('click', () => chatPanel.classList.toggle('hidden'));
document.getElementById('chat-close').addEventListener('click', () => chatPanel.classList.add('hidden'));

document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.getElementById('chat-input').value = chip.dataset.msg;
        sendChatMessage();
    });
});

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    document.querySelector('.chat-suggestions')?.remove();
    appendMessage('user', text);
    input.value = '';
    scrollChat();
    const loadId = appendMessage('system', '<i class="ri-loader-4-line ri-spin"></i> Nexus AI is thinking...');
    scrollChat();
    try {
        const user = JSON.parse(sessionStorage.getItem('nexus_user') || '{}');
        const res = await authFetch(`${API}/chat`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                message: text,
                conversation_history: chatHistory,
                user_role: user.role || 'admin',
                user_name: user.name || 'Admin'
            })
        });
        const data = await res.json();
        const badge = data.ai_powered
            ? '<span style="font-size:0.65rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:2px 6px;border-radius:999px;margin-bottom:4px;display:inline-block">⚡ Nexus AI</span><br>'
            : '';
        updateMessage(loadId, badge + data.reply);

        // Handle legacy action navigation
        if (data.action) handleChatAction(data.action);

        // Auto-refresh views based on what the AI modified
        if (data.refresh_required && data.refresh_required.length > 0) {
            setTimeout(() => {
                data.refresh_required.forEach(view => {
                    if (view === 'dashboard') { dataCache = {}; fetchDashboard(); }
                    else if (view === 'projects') { dataCache = {}; if (currentView === 'projects') fetchProjects(); }
                    else if (view === 'team') { dataCache = {}; if (currentView === 'team') fetchTeam(); }
                    else if (view === 'kanban') { dataCache = {}; if (currentView === 'kanban') fetchKanban(); }
                });
            }, 800);
        }

        chatHistory.push({role:'user',text}, {role:'model',text:data.reply});
    } catch {
        updateMessage(loadId, '❌ Could not reach Nexus backend. Is the server running?');
    }
    scrollChat();
}

function handleChatAction(action) {
    setTimeout(() => {
        if (action.type === 'navigate') { switchView(action.view); showToast(`Navigated to ${action.view}`, 'info', 'ri-navigation-line'); }
        else if (action.type === 'show_report') { openReportModal(); }
        else if (action.type === 'toast') { showToast(action.message, action.status||'success', 'ri-check-line'); dataCache={}; if(currentView==='kanban') fetchKanban(); }
        else if (action.type === 'task_created') { dataCache={}; switchView('kanban'); }
    }, 800);
}

function appendMessage(type, content) {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const div = document.createElement('div');
    div.className = `message ${type}`; div.id = id;
    div.innerHTML = `<div class="message-content">${content}</div>`;
    document.getElementById('chat-messages').appendChild(div);
    return id;
}
function updateMessage(id, content) { const el=document.getElementById(id); if(el) el.querySelector('.message-content').innerHTML=content; }
function scrollChat() { const el=document.getElementById('chat-messages'); el.scrollTop=el.scrollHeight; }

document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keypress', e => { if(e.key==='Enter') sendChatMessage(); });

// ─── Notifications ────────────────────────────────────────────────────────────
const notifPanel = document.getElementById('notif-panel');
const notifOverlay = document.getElementById('notif-overlay');

// Track unread count from the initial 3 unread items
let _unreadCount = document.querySelectorAll('.notif-item.unread').length;

function _syncNotifDot() {
    const dot = document.getElementById('notif-dot');
    const badge = document.getElementById('notif-badge');
    if (_unreadCount > 0) {
        dot.classList.add('visible');
        badge.textContent = _unreadCount;
        badge.classList.add('visible');
    } else {
        dot.classList.remove('visible');
        badge.classList.remove('visible');
    }
}

// Initialize dot state on load
_syncNotifDot();

// "Mark all read" button
document.getElementById('notif-mark-all').addEventListener('click', () => {
    document.querySelectorAll('#notif-list .notif-item.unread').forEach(item => item.classList.remove('unread'));
    _unreadCount = 0;
    _syncNotifDot();
    showToast('All notifications marked as read', 'success', 'ri-check-double-line');
});

async function postNotification(title, message, iconClass, iconBg, iconColor, roles = ['all']) {
    try {
        await authFetch(`${API}/notifications`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ title, message, iconClass, iconBg, iconColor, roles })
        });
    } catch {}
}

let lastNotifId = 0;
async function fetchNotifications() {
    try {
        const res = await authFetch(`${API}/notifications`);
        const notifs = await res.json();
        const user = JSON.parse(sessionStorage.getItem('nexus_user') || '{}');
        const role = user.role || 'admin';
        
        for (const notif of notifs) {
            if (notif.id > lastNotifId) {
                lastNotifId = notif.id;
                // only display if role matches
                if (notif.roles.includes('all') || notif.roles.includes(role)) {
                    addNotificationLocal(notif.title, notif.message, notif.iconClass, notif.iconBg, notif.iconColor, notif.id);
                }
            }
        }
    } catch {}
}
setInterval(fetchNotifications, 10000);
setTimeout(fetchNotifications, 2000);

function addNotificationLocal(title, message, iconClass, iconBg, iconColor, timestampMs) {
    const list = document.getElementById('notif-list');
    const id = timestampMs || (Date.now() + Math.random());
    const item = document.createElement('div');
    item.className = 'notif-item unread';
    item.dataset.notifId = id;
    
    const readNotifs = JSON.parse(localStorage.getItem('nexus_readNotifs') || '[]');
    if (readNotifs.includes(id)) {
        item.classList.remove('unread');
    }
    
    let timeStr = 'Just now';
    if (timestampMs) {
        const diff = Date.now() - timestampMs;
        if (diff > 86400000) timeStr = Math.floor(diff/86400000) + 'd ago';
        else if (diff > 3600000) timeStr = Math.floor(diff/3600000) + 'h ago';
        else if (diff > 60000) timeStr = Math.floor(diff/60000) + 'm ago';
    }

    item.innerHTML = `
        <div class="notif-icon-wrap" style="background:${iconBg};color:${iconColor}"><i class="${iconClass}"></i></div>
        <div class="notif-content"><strong>${title}</strong><p>${message}</p><span>${timeStr}</span></div>
        <div class="notif-unread-indicator"></div>`;
    list.prepend(item);
    item.addEventListener('click', () => {
        if (item.classList.contains('unread')) {
            item.classList.remove('unread');
            _unreadCount = Math.max(0, _unreadCount - 1);
            _syncNotifDot();
            
            const rn = JSON.parse(localStorage.getItem('nexus_readNotifs') || '[]');
            if (!rn.includes(id)) {
                rn.push(id);
                localStorage.setItem('nexus_readNotifs', JSON.stringify(rn));
            }
        }
    });
    
    if (item.classList.contains('unread')) {
        _unreadCount++;
        _syncNotifDot();
    }
}

document.getElementById('notif-bell').addEventListener('click', () => {
    const isOpen = !notifPanel.classList.contains('hidden');
    if (isOpen) { closeNotifPanel(); }
    else {
        notifPanel.classList.remove('hidden');
        notifOverlay.classList.remove('hidden');
        // DO NOT auto-clear — dot stays until each item is clicked
    }
});
function closeNotifPanel() { notifPanel.classList.add('hidden'); notifOverlay.classList.add('hidden'); }
document.getElementById('notif-close').addEventListener('click', closeNotifPanel);
notifOverlay.addEventListener('click', closeNotifPanel);

// ─── Settings ─────────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
    if (e.target.id==='save-api-key-btn'||e.target.closest('#save-api-key-btn')) {
        const key = document.getElementById('setting-api-key').value.trim();
        if (!key) {
            showToast('Please enter a valid API key.', 'error', 'ri-error-warning-line');
            return;
        }
        const btn = e.target.closest('#save-api-key-btn');
        btn.textContent = 'Saving...';
        const model = document.getElementById('setting-ai-model').value;
        fetch(`${API}/settings/api-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, model })
        }).then(res => res.json()).then(data => {
            if (data.success) {
                showToast('API Key saved! Restarting AI services...', 'success', 'ri-key-line');
            } else {
                showToast('Failed to save API key', 'error', 'ri-error-warning-line');
            }
        }).catch(() => {
            showToast('Error connecting to backend', 'error', 'ri-error-warning-line');
        }).finally(() => {
            btn.innerHTML = '<i class="ri-save-line"></i> Save';
        });
    }
    if (e.target.classList.contains('btn-connect')) {
        const btn = e.target;
        const name = btn.closest('.integration-item').querySelector('.integration-info span').textContent;
        const badge = document.createElement('span');
        badge.className = 'integration-badge connected';
        badge.textContent = 'Connected';
        
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
        btn.disabled = true;
        
        setTimeout(() => {
            btn.replaceWith(badge);
            showToast(`${name} integration connected successfully!`, 'success', 'ri-links-line');
            localStorage.setItem(`nexus_integration_${name}`, 'connected');
        }, 800);
    }
    
    if (e.target.classList.contains('integration-badge') && e.target.classList.contains('connected')) {
        const badge = e.target;
        const name = badge.closest('.integration-item').querySelector('.integration-info span').textContent;
        const btn = document.createElement('button');
        btn.className = 'btn-connect';
        btn.textContent = 'Connect';
        
        badge.textContent = 'Disconnecting...';
        badge.style.opacity = '0.7';
        
        setTimeout(() => {
            badge.replaceWith(btn);
            showToast(`${name} disconnected.`, 'info', 'ri-link-unlink-m');
            localStorage.removeItem(`nexus_integration_${name}`);
        }, 500);
    }
});

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    // Only allow global shortcuts if user is logged in
    if (!sessionStorage.getItem('nexus_user')) return;

    const tag = document.activeElement.tagName.toLowerCase();
    if (tag==='input'||tag==='textarea'||tag==='select') { if(e.key==='Escape') document.activeElement.blur(); return; }
    switch(e.key.toLowerCase()) {
        case 'd': switchView('dashboard'); break;
        case 'p': switchView('projects'); break;
        case 'a': switchView('agents'); break;
        case 't': switchView('team'); break;
        case 's': switchView('settings'); break;
        case 'c': chatPanel.classList.toggle('hidden'); if(!chatPanel.classList.contains('hidden')) document.getElementById('chat-input').focus(); break;
        case 'g': openReportModal(); break;
        case 'r': dataCache={}; loadViewData(currentView); showToast('Refreshed','info','ri-refresh-line'); break;
        case '/': e.preventDefault(); document.getElementById('global-search').focus(); break;
        case 'escape': document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.add('hidden')); closeNotifPanel(); chatPanel.classList.add('hidden'); break;
    }
});

// ─── Search ───────────────────────────────────────────────────────────────────
document.getElementById('global-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) return;
    if (['risk','block','delay'].some(w=>q.includes(w))) switchView('dashboard');
    else if (['project','omega','atlas','mercury','nova'].some(w=>q.includes(w))) switchView('projects');
    else if (['team','alice','bob','sarah','alex','capacity'].some(w=>q.includes(w))) switchView('team');
    else if (['agent','sentinel','strategist','scribe','executor'].some(w=>q.includes(w))) switchView('agents');
});
document.getElementById('global-search').addEventListener('keypress', e => {
    if (e.key==='Enter') { const q=e.target.value.trim(); if(!q) return; document.getElementById('chat-input').value=q; e.target.value=''; chatPanel.classList.remove('hidden'); sendChatMessage(); }
});

// ─── Kanban Board ─────────────────────────────────────────────────────────────
async function fetchKanban() {
    const board = document.getElementById('kanban-board');
    board.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line ri-spin"></i></div>';
    try {
        const filter = document.getElementById('kanban-filter').value;
        const endpoint = filter==='all' ? '/tasks' : `/tasks?project=${encodeURIComponent(filter)}`;
        const tasks = await api(endpoint);
        renderKanban(tasks);
    } catch {
        board.innerHTML = `<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Failed to load tasks.</div>`;
    }
}

function renderKanban(tasks) {
    const cols = { todo:[], in_progress:[], review:[], blocked:[], done:[] };
    tasks.forEach(t => { if(cols[t.status]) cols[t.status].push(t); else cols.todo.push(t); });
    const colTitles = { todo:'To Do', in_progress:'In Progress', review:'Review', blocked:'Blocked', done:'Done' };
    const colIcons  = { todo:'ri-circle-line', in_progress:'ri-loader-2-line', review:'ri-eye-line', blocked:'ri-error-warning-line', done:'ri-checkbox-circle-line' };

    // Must be declared BEFORE template literals that reference it
    const user = JSON.parse(sessionStorage.getItem('nexus_user') || '{}');
    const isMember = user.role === 'member';

    const board = document.getElementById('kanban-board');
    board.innerHTML = Object.keys(cols).map(key => `
        <div class="kanban-column" data-status="${key}">
            <div class="kanban-column-header">
                <div style="display:flex;align-items:center;gap:6px">
                    <i class="${colIcons[key]}"></i>${colTitles[key]}
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                    ${key === 'done' && user.role === 'admin' ? `<button onclick="clearDoneTasks()" title="Clear all Done tasks" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:0;font-size:1rem"><i class="ri-delete-bin-line"></i></button>` : ''}
                    <span class="column-count">${cols[key].length}</span>
                </div>
            </div>
            <div class="kanban-cards" data-status="${key}">
                ${cols[key].map(t => `
                    <div class="kanban-card" draggable="true" data-id="${t.id}" data-current-status="${t.status}">
                        <div class="kanban-card-top">
                            <span class="kanban-card-title">${t.title}</span>
                            <div style="display:flex;align-items:center;gap:6px">
                                <div class="task-priority-dot priority-${t.priority}"></div>
                                ${user.role === 'admin' ? `<button onclick="deleteTask(${t.id})" class="task-delete-btn" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:0"><i class="ri-delete-bin-line"></i></button>` : ''}
                            </div>
                        </div>
                        <div class="kanban-card-project">${t.project}</div>
                        <div class="kanban-card-bottom">
                            <div class="kanban-assignee">
                                <div class="kanban-avatar" style="background:hsl(${t.assignee.charCodeAt(0)*7%360},60%,45%)">${t.assignee[0]}</div>
                                ${t.assignee}
                            </div>
                        </div>
                    </div>`).join('')}
            </div>
        </div>`).join('');

    // Feature 4: One-way Kanban drag-and-drop (user/isMember declared above)

    document.querySelectorAll('.kanban-card').forEach(card => {
        if (!isMember) {
            card.addEventListener('dragstart', () => card.classList.add('dragging'));
            card.addEventListener('dragend',   () => card.classList.remove('dragging'));
        } else {
            card.removeAttribute('draggable');
            card.style.cursor = 'default';
        }
    });

    if (isMember) return; // Do not add dragover/drop listeners for members

    document.querySelectorAll('.kanban-cards').forEach(container => {
        container.addEventListener('dragover', e => {
            e.preventDefault();
            const after = getDragAfterElement(container, e.clientY);
            const dragging = document.querySelector('.dragging');
            if (after==null) container.appendChild(dragging);
            else container.insertBefore(dragging, after);
        });

        container.addEventListener('drop', async e => {
            const card = document.querySelector('.dragging');
            if (!card) return;

            const newStatus     = container.dataset.status;
            const currentStatus = card.dataset.currentStatus;
            const taskId        = card.dataset.id;

            const newOrder = STATUS_ORDER[newStatus];
            const curOrder = STATUS_ORDER[currentStatus];

            // Feature 4a: Prevent backward movement
            if (newOrder !== -1 && curOrder !== -1 && newOrder < curOrder) {
                showToast(`Tasks can only move forward! (${STATUS_LABELS[currentStatus]} → next step)`, 'error', 'ri-arrow-right-line');
                fetchKanban();
                return;
            }

            // Feature 4b: Prevent dropping into same column
            if (newStatus === currentStatus) return;

            // Feature 4c: Require confirmation to mark as Done
            if (newStatus === 'done') {
                const taskTitle = card.querySelector('.kanban-card-title').textContent;
                const confirmed = await showTaskDoneConfirm(taskTitle);
                if (!confirmed) {
                    fetchKanban();
                    return;
                }
            }

            // Optimistic update
            card.dataset.currentStatus = newStatus;
            const countSpan = container.parentElement.querySelector('.column-count');
            if (countSpan) countSpan.textContent = parseInt(countSpan.textContent) + 1;

            try {
                const res = await authFetch(`${API}/tasks/${taskId}`, {
                    method: 'PATCH', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ status: newStatus })
                });
                if (!res.ok) throw new Error('API Error');
                dataCache = {};
                const movedByUser = JSON.parse(sessionStorage.getItem('nexus_user') || '{}');
                showToast(`Task moved to ${STATUS_LABELS[newStatus]}`, 'success', 'ri-checkbox-circle-line');
                // Progress notification visible to all
                postNotification(
                    'Task Progress Update',
                    `${movedByUser.name || 'A member'} moved a task to "${STATUS_LABELS[newStatus]}".`,
                    'ri-task-line', 'rgba(16,185,129,0.15)', '#10b981', ['all']
                );
            } catch {
                showToast('Failed to update task', 'error', 'ri-error-warning-line');
                fetchKanban();
            }
        });
    });
}

function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.kanban-card:not(.dragging)')];
    return els.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height/2;
        if (offset<0 && offset>closest.offset) return {offset, element:child};
        return closest;
    }, {offset:Number.NEGATIVE_INFINITY}).element;
}

document.getElementById('kanban-filter').addEventListener('change', () => { dataCache={}; fetchKanban(); });

document.getElementById('btn-quick-task').addEventListener('click', () => {
    document.getElementById('quick-add-form').classList.remove('hidden');
    document.getElementById('qa-title').focus();
});
document.getElementById('qa-cancel').addEventListener('click', () => {
    document.getElementById('quick-add-form').classList.add('hidden');
});
document.getElementById('qa-submit').addEventListener('click', async () => {
    const title = document.getElementById('qa-title').value.trim();
    if (!title) return;
    try {
        await authFetch(`${API}/tasks`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ title, project:document.getElementById('qa-project').value, assignee:document.getElementById('qa-assignee').value, priority:document.getElementById('qa-priority').value, status:'todo' })
        });
        document.getElementById('qa-title').value = '';
        document.getElementById('quick-add-form').classList.add('hidden');
        dataCache = {};
        fetchKanban();
        showToast('Task added!', 'success');
    } catch { showToast('Failed to add task', 'error', 'ri-error-warning-line'); }
});

// ─── Admin Task Controls ───────────────────────────────────────────────────────
// Delete any single task by ID (admin only - button rendered in card HTML)
window.deleteTask = async function(id) {
    const confirmed = await showConfirmModal(
        'Delete this task?',
        'This action is permanent and cannot be undone.',
        'Task Management'
    );
    if (!confirmed) return;
    try {
        const res = await authFetch(`${API}/tasks/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Task deleted', 'success', 'ri-delete-bin-line');
            dataCache = {};
            fetchKanban();
        } else {
            let msg = 'Failed to delete task';
            try { const d = await res.json(); msg = d.detail || msg; } catch {}
            showToast(msg, 'error', 'ri-error-warning-line');
        }
    } catch (err) {
        showToast('Network error — could not delete task', 'error', 'ri-error-warning-line');
    }
};

// Clear all tasks in the Done column (admin only)
window.clearDoneTasks = async function() {
    const confirmed = await showConfirmModal(
        'Clear all Done tasks?',
        'All tasks in the Done column will be permanently deleted.\nThis cannot be undone.',
        'Board Management'
    );
    if (!confirmed) return;
    try {
        const res = await authFetch(`${API}/tasks`);
        const tasks = await res.json();
        const doneTasks = tasks.filter(t => t.status === 'done');
        if (doneTasks.length === 0) {
            showToast('Done column is already empty', 'info', 'ri-information-line');
            return;
        }
        let deleted = 0;
        for (const t of doneTasks) {
            const delRes = await authFetch(`${API}/tasks/${t.id}`, { method: 'DELETE' });
            if (delRes.ok) deleted++;
        }
        showToast(`Cleared ${deleted} completed task${deleted !== 1 ? 's' : ''}`, 'success', 'ri-check-double-line');
        dataCache = {};
        fetchKanban();
    } catch {
        showToast('Error clearing done tasks', 'error', 'ri-error-warning-line');
    }
};

// ─── Greeting + Init ──────────────────────────────────────────────────────────
function updateGreeting() {
    const user = JSON.parse(sessionStorage.getItem('nexus_user') || '{}');
    const firstName = (user.name || 'Admin').split(' ')[0];
    const h = new Date().getHours();
    const greet = h<12?'Good morning':h<17?'Good afternoon':'Good evening';
    const el = document.querySelector('#view-dashboard .page-title');
    if (el) el.textContent = `${greet}, ${firstName}.`;
}

function updateDashboardSubtitle(activeProjectsCount, agentsCount) {
    const subtitle = document.querySelector('#view-dashboard .subtitle');
    if (subtitle) {
        subtitle.innerHTML = `Nexus is monitoring active projects and agent swarms.`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Only init the app if user is already authenticated.
    // If not, the auth gate (initAuth IIFE below) handles the launchApp() call.
    if (sessionStorage.getItem('nexus_user')) {
        fetchDashboard();
        updateGreeting();
        setTimeout(() => showToast('Tip: Press D/P/A/T to navigate · Esc to close modals', 'info', 'ri-keyboard-line'), 3000);
    }
});

// ─── Meeting Notification Engine (1 hr 30 min prior) ─────────────────────────
const _notifiedMeetings = new Set();  // track which projects we already notified

async function checkUpcomingMeetings() {
    try {
        const res = await authFetch(`${API}/projects`);
        const projects = await res.json();
        const now = new Date();

        for (const p of projects) {
            if (!p.meeting_time) continue;

            // Parse today's meeting time
            const [hours, minutes] = p.meeting_time.split(':').map(Number);
            const meetingDate = new Date();
            meetingDate.setHours(hours, minutes, 0, 0);

            // Calculate minutes until meeting
            const diffMs = meetingDate - now;
            const diffMins = diffMs / 60000;

            // Notification at 60 minutes before
            const notif60Key = `${p.id}-60-${p.meeting_time}-${now.toDateString()}`;
            if (diffMins >= 58 && diffMins <= 62 && !_notifiedMeetings.has(notif60Key)) {
                _notifiedMeetings.add(notif60Key);
                showToast(`Meeting in 1 hour: <strong>${p.name}</strong> @ ${p.meeting_time}`, 'info', 'ri-calendar-event-line');
                if (Notification && Notification.permission === 'granted') {
                    new Notification('Upcoming Meeting – Nexus', {
                        body: `"${p.name}" meeting starts at ${p.meeting_time} (in ~1 hour)`,
                        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%236366f1"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
                        requireInteraction: true
                    });
                }
            }

            // Notification at 30 minutes before
            const notif30Key = `${p.id}-30-${p.meeting_time}-${now.toDateString()}`;
            if (diffMins >= 28 && diffMins <= 32 && !_notifiedMeetings.has(notif30Key)) {
                _notifiedMeetings.add(notif30Key);
                showToast(`Meeting in 30 mins: <strong>${p.name}</strong> @ ${p.meeting_time}`, 'info', 'ri-time-line');
                if (Notification && Notification.permission === 'granted') {
                    new Notification('Meeting Soon – Nexus', {
                        body: `"${p.name}" meeting starts at ${p.meeting_time} (in ~30 mins)`,
                        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%236366f1"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
                        requireInteraction: true
                    });
                }
            }

            // Warn 5 min before
            const soonKey = `${p.id}-soon-${p.meeting_time}-${now.toDateString()}`;
            if (diffMins >= 3 && diffMins <= 7 && !_notifiedMeetings.has(soonKey)) {
                _notifiedMeetings.add(soonKey);
                showToast(
                    `<i class="ri-alarm-warning-line"></i> Meeting starting in 5 mins: <strong>${p.name}</strong>${p.meeting_details ? ' — <a href="' + p.meeting_details + '" target="_blank" style="color:inherit">Join now ↗</a>' : ''}`,
                    'error',
                    'ri-alarm-warning-line'
                );
                addNotificationLocal('Meeting Starting Soon', `"${p.name}" starts in 5 mins`, 'ri-alarm-warning-line', 'rgba(244,63,94,0.1)', 'var(--status-red)');
            }
        }
    } catch {
        // Silently ignore errors in background checker
    }
}

// ─── Sidebar Toggle ───────────────────────────────────────────────────────────
document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.querySelector('.app-container').classList.toggle('sidebar-collapsed');
});

// Request browser notification permission on load
function requestNotifPermission() {
    if (Notification && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Start the notification engine: check every 60 seconds
setTimeout(requestNotifPermission, 2000);
setInterval(checkUpcomingMeetings, 60000);
// Also run immediately after 5s (in case a meeting is right now)
setTimeout(checkUpcomingMeetings, 5000);

// ─── Onboarding Tutorial ──────────────────────────────────────────────────────
const tutorialSteps = [
    { title: 'Welcome to Nexus!', text: 'Nexus is your AI-powered project operations center. Let\'s take a 60-second tour to get you started.', icon: '<i class="ri-hand-coin-line"></i>' },
    { title: 'Dashboard Overview', text: 'Here you can see your active projects, team workload, and critical risk alerts generated by the Sentinel Agent.', icon: '<i class="ri-dashboard-3-line"></i>' },
    { title: 'Project Management', text: 'Click "New Project" to add a project. You can set deadlines, meeting links, and meeting times. Projects can be edited or soft-deleted into the Vault.', icon: '<i class="ri-folder-chart-line"></i>' },
    { title: 'Agent Swarm', text: 'Nexus uses 4 specialized AI Agents (Planner, Sentinel, Executor, Scribe). You can chat with them directly using the chat widget in the bottom right!', icon: '<i class="ri-robot-2-line"></i>' },
    { title: 'Team & Kanban', text: 'Manage team capacity automatically. As you move tasks on the Kanban board, Nexus automatically calculates project progress and team workload.', icon: '<i class="ri-layout-column-line"></i>' }
];
let currentStep = 0;

function renderTutorialStep() {
    const step = tutorialSteps[currentStep];
    document.getElementById('tutorial-title').textContent = step.title;
    document.getElementById('tutorial-body').textContent = step.text;
    document.getElementById('tutorial-icon').innerHTML = step.icon;
    document.getElementById('tutorial-step-counter').textContent = `Step ${currentStep + 1} of ${tutorialSteps.length}`;
    
    document.getElementById('tutorial-prev-btn').disabled = currentStep === 0;
    
    const nextBtn = document.getElementById('tutorial-next-btn');
    if (currentStep === tutorialSteps.length - 1) {
        nextBtn.innerHTML = '<i class="ri-rocket-line"></i> Get Started';
    } else {
        nextBtn.textContent = 'Next →';
    }
    
    document.querySelectorAll('.tdot').forEach((dot, idx) => {
        if (idx === currentStep) dot.classList.add('active');
        else dot.classList.remove('active');
    });
}

document.getElementById('tutorial-next-btn').addEventListener('click', () => {
    if (currentStep < tutorialSteps.length - 1) {
        currentStep++;
        renderTutorialStep();
    } else {
        closeTutorial();
    }
});

document.getElementById('tutorial-prev-btn').addEventListener('click', () => {
    if (currentStep > 0) {
        currentStep--;
        renderTutorialStep();
    }
});

document.getElementById('skip-tutorial-btn').addEventListener('click', closeTutorial);

function closeTutorial() {
    document.getElementById('onboarding-overlay').style.display = 'none';
    localStorage.setItem('nexus_tutorial_seen', 'true');
}

// Trigger tutorial if not seen
if (!localStorage.getItem('nexus_tutorial_seen')) {
    setTimeout(() => {
        document.getElementById('onboarding-overlay').style.display = 'flex';
        renderTutorialStep();
    }, 1500);
} else {
    document.getElementById('onboarding-overlay').style.display = 'none';
}

// Allow reopening tutorial by clicking the AD avatar — show profile dropdown instead
document.getElementById('admin-avatar').addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.getElementById('profile-dropdown');
    if (existing) { existing.remove(); return; }
    const user = JSON.parse(sessionStorage.getItem('nexus_user') || '{"name":"Admin","email":"admin@nexus.ai","method":"Email"}');
    const avatarEl = document.getElementById('admin-avatar');
    const wrapper = avatarEl.parentElement;
    wrapper.style.position = 'relative';
    const dropdown = document.createElement('div');
    dropdown.id = 'profile-dropdown';
    dropdown.className = 'user-profile-dropdown';
    dropdown.innerHTML = `
        <div class="user-profile-info">
            <div class="user-profile-name">${user.name}</div>
            <div class="user-profile-email">${user.email}</div>
            <div class="user-profile-method"><i class="ri-${user.method === 'Google' ? 'google' : 'mail'}-line"></i> ${user.method} Sign-In</div>
        </div>
        <button class="profile-menu-item" onclick="currentStep=0;document.getElementById('onboarding-overlay').style.display='flex';renderTutorialStep();document.getElementById('profile-dropdown').remove()">
            <i class="ri-compass-discover-line"></i> View Tutorial
        </button>
        <button class="profile-menu-item" onclick="switchView('settings');document.getElementById('profile-dropdown').remove()">
            <i class="ri-settings-4-line"></i> Settings
        </button>
        <button class="profile-menu-item" id="profile-edit-self-btn">
            <i class="ri-user-settings-line"></i> Edit Profile
        </button>
        <button class="profile-menu-item logout" id="profile-logout-btn">
            <i class="ri-logout-box-line"></i> Sign Out
        </button>`;
    wrapper.appendChild(dropdown);
    
    const handleLogout = () => {
        clearToken();
        sessionStorage.removeItem('nexus_user');
        location.reload();
    };
    
    document.getElementById('profile-logout-btn').addEventListener('click', handleLogout);
    
    document.getElementById('profile-edit-self-btn').addEventListener('click', () => {
        dropdown.remove();
        document.getElementById('me-name').value = user.name;
        document.getElementById('me-role').value = user.role;
        document.getElementById('me-email').value = user.email || '';
        document.getElementById('me-password').value = '';
        document.getElementById('me-position').value = user.role === 'admin' ? 'admin' : 'member';
        document.getElementById('me-original-email').value = user.email || user.name;
        document.getElementById('member-edit-modal-overlay').classList.remove('hidden');
    });

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function closeDD(ev) {
            if (!dropdown.contains(ev.target)) { dropdown.remove(); document.removeEventListener('click', closeDD); }
        });
    }, 0);
});

// ─── Settings / API Key ───────────────────────────────────────────────────────
const savedKey = localStorage.getItem('nexus_gemini_key');
if (savedKey) {
    const input = document.getElementById('setting-api-key');
    if (input) input.value = savedKey;
}

const saveApiKeyBtn = document.getElementById('save-api-key-btn');
if (saveApiKeyBtn) {
    saveApiKeyBtn.addEventListener('click', async () => {
        const key = document.getElementById('setting-api-key').value.trim();
        if (!key) {
            showToast('Please enter an API key', 'error', 'ri-error-warning-line');
            return;
        }
        const btn = document.getElementById('save-api-key-btn');
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Saving...';
        btn.disabled = true;
        try {
            const res = await authFetch(`${API}/settings/api-key`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key })
            });
            if (res.ok) {
                localStorage.setItem('nexus_gemini_key', key);
                showToast('Gemini API Key saved and activated!', 'success', 'ri-check-line');
            } else {
                throw new Error('Failed to save');
            }
        } catch (err) {
            showToast('Failed to save API Key to backend', 'error', 'ri-error-warning-line');
        } finally {
            btn.innerHTML = '<i class="ri-save-line"></i> Save';
            btn.disabled = false;
        }
    });
}


// ─── Custom Task Done Confirmation Dialog ────────────────────────────────────────
// Returns a Promise<boolean> — true if confirmed, false if cancelled
function showTaskDoneConfirm(taskTitle) {
    return new Promise(resolve => {
        const overlay = document.getElementById('task-done-overlay');
        const nameEl  = document.getElementById('task-done-name');
        const confirmBtn = document.getElementById('task-done-confirm');
        const cancelBtn  = document.getElementById('task-done-cancel');

        nameEl.textContent = taskTitle;
        overlay.classList.remove('hidden');

        function cleanup(result) {
            overlay.classList.add('hidden');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlay);
            resolve(result);
        }

        const onConfirm = () => cleanup(true);
        const onCancel  = () => cleanup(false);
        const onOverlay = (e) => { if (e.target === overlay) cleanup(false); };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlay);
    });
}

// ─── Member Dashboard ─────────────────────────────────────────────────────────
async function fetchMemberDashboard() {
    const user = JSON.parse(sessionStorage.getItem('nexus_user') || '{}');
    const firstName = (user.name || 'there').split(' ')[0];
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const greetEl = document.getElementById('member-dash-greeting');
    if (greetEl) greetEl.textContent = `${greet}, ${firstName}!`;

    // Fill in profile card
    const avatarEl = document.getElementById('member-profile-avatar');
    const nameEl   = document.getElementById('member-profile-name');
    const emailEl  = document.getElementById('member-profile-email');
    if (avatarEl) avatarEl.textContent = (user.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    if (nameEl)   nameEl.textContent   = user.name || 'Unknown';
    if (emailEl)  emailEl.textContent  = user.email || '';

    // Load projects & tasks from API
    try {
        const [projects, tasks] = await Promise.all([
            api('/projects'),
            api('/tasks')
        ]);

        // My projects — projects where user name appears in team array
        const myProjects = projects.filter(p => p.team && p.team.some(t => t.toLowerCase().includes(firstName.toLowerCase())));
        const projGrid = document.getElementById('member-projects-grid');
        if (projGrid) {
            if (myProjects.length === 0) {
                projGrid.innerHTML = '<div class="loading-state"><i class="ri-folder-open-line"></i> No projects assigned yet</div>';
            } else {
                projGrid.innerHTML = myProjects.map(p => `
                    <div class="project-card glass-panel" style="cursor:pointer" data-project-id="${p.id}">
                        <div class="project-header">
                            <span class="project-color" style="background:${p.color}"></span>
                            <span class="project-name">${p.name}</span>
                        </div>
                        <p class="project-desc">${p.description || ''}</p>
                        <div style="margin-top:auto;padding-top:12px;">
                            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:0.8rem;color:#6b7a9e;">
                                <span>Progress</span><span>${p.progress || 0}%</span>
                            </div>
                            <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;">
                                <div style="height:100%;width:${p.progress || 0}%;background:${p.color};border-radius:2px;"></div>
                            </div>
                            <div style="margin-top:8px;font-size:0.78rem;color:#6b7a9e;"><i class="ri-calendar-line"></i> ${p.deadline || 'No deadline'}</div>
                        </div>
                    </div>`).join('');
                projGrid.querySelectorAll('.project-card').forEach(card => {
                    card.addEventListener('click', () => openProjectModal(parseInt(card.dataset.projectId)));
                });
            }
        }

        // KPI counts
        const myTasks   = tasks.filter(t => t.assignee && t.assignee.toLowerCase().includes(firstName.toLowerCase()));
        const activeTasks    = myTasks.filter(t => t.status !== 'done');
        const completedTasks = myTasks.filter(t => t.status === 'done');
        const kpiTasks = document.getElementById('member-kpi-tasks');
        const kpiProj  = document.getElementById('member-kpi-projects');
        const kpiDone  = document.getElementById('member-kpi-done');
        if (kpiTasks) kpiTasks.textContent = activeTasks.length;
        if (kpiProj)  kpiProj.textContent  = myProjects.length;
        if (kpiDone)  kpiDone.textContent  = completedTasks.length;

        // My task list
        const taskList = document.getElementById('member-task-list');
        if (taskList) {
            if (myTasks.length === 0) {
                taskList.innerHTML = '<div class="loading-state"><i class="ri-task-line"></i> No tasks assigned yet</div>';
            } else {
                const STATUS_PILL = { todo:'#6b7a9e', in_progress:'#6366f1', review:'#f59e0b', done:'#10b981', blocked:'#f43f5e' };
                const STATUS_LBL  = { todo:'To Do', in_progress:'In Progress', review:'In Review', done:'Done', blocked:'Blocked' };
                taskList.innerHTML = myTasks.slice(0, 10).map(t => `
                    <div class="task-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                        <div style="flex:1;">
                            <div class="task-title" style="font-size:0.9rem;">${t.title}</div>
                            <div style="font-size:0.75rem;color:#6b7a9e;margin-top:3px;">${t.project}</div>
                        </div>
                        <span style="background:${STATUS_PILL[t.status] || '#6b7a9e'}22;color:${STATUS_PILL[t.status] || '#6b7a9e'};padding:3px 10px;border-radius:20px;font-size:0.75rem;white-space:nowrap;">${STATUS_LBL[t.status] || t.status}</span>
                    </div>`).join('');
            }
        }
    } catch(e) {
        const projGrid = document.getElementById('member-projects-grid');
        if (projGrid) projGrid.innerHTML = '<div class="loading-state text-red"><i class="ri-error-warning-line"></i> Could not load data</div>';
    }

    // Wire up member report button
    const reportBtn = document.getElementById('member-report-btn');
    if (reportBtn && !reportBtn._listenerAdded) {
        reportBtn._listenerAdded = true;
        reportBtn.addEventListener('click', () => {
            document.getElementById('report-modal-overlay').classList.remove('hidden');
            generateReport();
        });
    }
}

// ─── Authentication Gate ─────────────────────────────────────────────────────────
(function initAuth() {
    let usersDB = null;
    try {
        usersDB = JSON.parse(localStorage.getItem('nexus_usersDB'));
    } catch (e) {
        console.warn("Resetting corrupted nexus_usersDB");
        usersDB = null;
    }
    if (!usersDB || !Array.isArray(usersDB) || usersDB.length === 0 || !usersDB.find(u => u.email === 'admin@nexus.ai')) {
        usersDB = [
            { name: 'Admin User', email: 'admin@nexus.ai', password: 'password', position: 'admin' },
            { name: 'Sarah Jenkins', email: 'sarah.j@company.com', password: 'password', position: 'member' }
        ];
        localStorage.setItem('nexus_usersDB', JSON.stringify(usersDB));
    }

    const landingScreen = document.getElementById('landing-screen');
    const loginScreen   = document.getElementById('login-screen');
    const appContainer  = document.getElementById('app-container');

    function launchApp(user) {
        if (!user.role) {
            const db = JSON.parse(localStorage.getItem('nexus_usersDB')) || [];
            const found = db.find(u => u.email === user.email);
            user.role = found ? found.position : (user.email === 'admin@nexus.ai' ? 'admin' : 'member');
        }
        // Persist user session for the tab
        sessionStorage.setItem('nexus_user', JSON.stringify(user));
        // Apply role-based body class (CSS handles all visibility rules)
        document.body.classList.remove('role-member', 'role-admin');
        document.body.classList.add(user.role === 'admin' ? 'role-admin' : 'role-member');
        // Update header avatar
        const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const avatarEl = document.getElementById('admin-avatar');
        avatarEl.textContent = initials;
        avatarEl.title = `${user.name} — Signed in as ${user.role}`;
        // Animate out auth screens
        if (landingScreen) landingScreen.style.display = 'none';
        loginScreen.classList.add('closing');
        setTimeout(() => {
            loginScreen.style.display = 'none';
            appContainer.style.display = 'grid';
            document.body.style.overflow = 'hidden';
            // Route to correct starting view
            if (user.role === 'member') {
                switchView('member-dash');
            } else {
                fetchDashboard();
                updateGreeting();
                switchView('dashboard');
            }
            // Restore saved integration connection states
            restoreIntegrationStates();
        }, 480);
    }

    function restoreIntegrationStates() {
        document.querySelectorAll('.integration-item').forEach(item => {
            const name = item.querySelector('.integration-info span')?.textContent;
            if (!name) return;
            if (localStorage.getItem(`nexus_integration_${name}`) === 'connected') {
                const btn = item.querySelector('.btn-connect');
                if (btn) {
                    const badge = document.createElement('span');
                    badge.className = 'integration-badge connected';
                    badge.textContent = 'Connected';
                    btn.replaceWith(badge);
                }
            }
        });
    }

    // Global logout handler for the header button
    const headerLogoutBtn = document.getElementById('logout-header-btn');
    if (headerLogoutBtn) {
        headerLogoutBtn.addEventListener('click', () => {
            clearToken();
            sessionStorage.removeItem('nexus_user');
            location.reload();
        });
    }

    // Check if already logged in — if so, skip both landing + login screens
    const existing = sessionStorage.getItem('nexus_user');
    if (existing) {
        if (landingScreen) landingScreen.style.display = 'none';
        loginScreen.style.display = 'none';
        appContainer.style.display = 'grid';
        const user = JSON.parse(existing);
        const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        document.getElementById('admin-avatar').textContent = initials;
        document.getElementById('admin-avatar').title = `${user.name} — Signed in as ${user.role || 'user'}`;
        // Re-apply role-based CSS class on restore
        document.body.classList.remove('role-member', 'role-admin');
        document.body.classList.add(user.role === 'admin' ? 'role-admin' : 'role-member');
        // App init already runs via DOMContentLoaded; return early
        return;
    }

    // Not logged in — show landing page, hide login screen initially
    if (landingScreen) {
        landingScreen.style.display = 'flex';
        loginScreen.style.display = 'none';

        const showLogin = () => {
            landingScreen.classList.add('closing');
            setTimeout(() => {
                landingScreen.style.display = 'none';
                landingScreen.classList.remove('closing');
                loginScreen.style.display = 'flex';
            }, 500);
        };

        const navLoginBtn  = document.getElementById('nav-btn-login');
        const heroStartBtn = document.getElementById('hero-btn-start');
        const stepsOverlay = document.getElementById('lp-steps-overlay');
        const btnCloseSteps = document.getElementById('btn-close-steps');
        const btnProceedLogin = document.getElementById('btn-proceed-login');
        
        if (navLoginBtn)  navLoginBtn.addEventListener('click', showLogin);
        
        if (heroStartBtn && stepsOverlay) {
            heroStartBtn.addEventListener('click', () => {
                stepsOverlay.classList.add('active');
            });
        }
        if (btnCloseSteps && stepsOverlay) {
            btnCloseSteps.addEventListener('click', () => {
                stepsOverlay.classList.remove('active');
            });
        }
        if (btnProceedLogin) {
            btnProceedLogin.addEventListener('click', () => {
                if (stepsOverlay) stepsOverlay.classList.remove('active');
                showLogin();
            });
        }
    }

    // — Back to Landing button —
    const btnBackToLanding = document.getElementById('btn-back-to-landing');
    if (btnBackToLanding && landingScreen) {
        btnBackToLanding.addEventListener('click', () => {
            loginScreen.classList.add('closing');
            setTimeout(() => {
                loginScreen.style.display = 'none';
                loginScreen.classList.remove('closing');
                landingScreen.style.display = 'flex';
                // Re-trigger landing entrance animations by resetting
                landingScreen.classList.remove('closing');
            }, 450);
        });
    }


    // — Email / Password Sign-In —
    const emailInput    = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const nameInput     = document.getElementById('login-name');
    const errorEl       = document.getElementById('login-error');
    const errorText     = document.getElementById('login-error-text');

    let isSignUp = false;
    document.getElementById('toggle-signup').addEventListener('click', (e) => {
        e.preventDefault();
        isSignUp = !isSignUp;
        document.getElementById('signup-name-group').classList.toggle('hidden', !isSignUp);
        document.getElementById('btn-email-login').innerHTML = isSignUp ? '<i class="ri-user-add-line"></i> Create Account' : '<i class="ri-login-box-line"></i> Sign In';
        e.target.textContent = isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up";
        hideLoginError();
    });

    function showLoginError(msg) {
        errorEl.classList.remove('hidden');
        errorText.textContent = msg;
        // Re-trigger shake animation
        errorEl.style.animation = 'none';
        errorEl.offsetHeight; // reflow
        errorEl.style.animation = 'shake 0.4s ease';
    }

    function hideLoginError() { errorEl.classList.add('hidden'); }

    // Password visibility toggle
    document.getElementById('login-eye-btn').addEventListener('click', () => {
        const icon = document.getElementById('login-eye-icon');
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            icon.className = 'ri-eye-line';
        } else {
            passwordInput.type = 'password';
            icon.className = 'ri-eye-off-line';
        }
    });

    document.getElementById('btn-email-login').addEventListener('click', async () => {
        const email    = emailInput.value.trim();
        const password = passwordInput.value;
        const nameVal  = nameInput ? nameInput.value.trim() : '';
        hideLoginError();

        // Basic validation
        if (isSignUp && !nameVal) { showLoginError('Please enter your name.'); nameInput.focus(); return; }
        if (!email) { showLoginError('Please enter your email address.'); emailInput.focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showLoginError('Please enter a valid email address.'); emailInput.focus(); return; }
        if (!password) { showLoginError('Please enter your password.'); passwordInput.focus(); return; }
        if (password.length < 6) { showLoginError('Password must be at least 6 characters.'); passwordInput.focus(); return; }

        const btn = document.getElementById('btn-email-login');
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> ' + (isSignUp ? 'Creating account...' : 'Signing in...');
        btn.disabled = true;

        let matchedUser = null;

        try {
            if (!isSignUp) {
                // Backend Sign In
                const res = await authFetch(`${API}/login`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({email, password})
                });
                if (!res.ok) {
                    showLoginError('Invalid email or password.');
                    btn.innerHTML = '<i class="ri-login-box-line"></i> Sign In';
                    btn.disabled = false;
                    return;
                }
                matchedUser = await res.json();
                // Store the session token from backend
                if (matchedUser.token) setToken(matchedUser.token);
                matchedUser.position = matchedUser.role; // map role to position for UI compatibility
            } else {
                // Backend Sign Up
                const res = await authFetch(`${API}/team`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        name: nameVal, email, password, role: 'Team Member', position: 'member', avatar_bg: '#6366f1'
                    })
                });
                if (!res.ok) {
                    showLoginError('Failed to create account or email already exists.');
                    btn.innerHTML = '<i class="ri-user-add-line"></i> Create Account';
                    btn.disabled = false;
                    return;
                }
                matchedUser = { name: nameVal, email, position: 'member' };
                // Do NOT store password in localStorage — it's insecure
                // Account creation is handled server-side
            }
        } catch (e) {
            showLoginError('Network error connecting to backend.');
            btn.innerHTML = isSignUp ? '<i class="ri-user-add-line"></i> Create Account' : '<i class="ri-login-box-line"></i> Sign In';
            btn.disabled = false;
            return;
        }

        // Store user info WITHOUT the password
        const safeUser = { name: matchedUser.name, email: matchedUser.email, role: matchedUser.position };
        launchApp(safeUser);
    });

    // Allow Enter key to submit
    [emailInput, passwordInput].forEach(inp => {
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('btn-email-login').click();
        });
    });

    // ─── GITHUB INTEGRATION ───
    const btnConnectGithub = document.getElementById('btn-connect-github');
    if (btnConnectGithub) {
        const overlayGithub = document.getElementById('github-modal-overlay');
        const btnCloseGithub = document.getElementById('github-modal-close');
        const btnSubmitGithub = document.getElementById('github-submit-btn');
        const inputPat = document.getElementById('github-pat-input');
        const statusText = document.getElementById('github-integration-status');
        const badgeContainer = document.getElementById('github-integration-item');
        
        // Check if already connected
        const savedPat = localStorage.getItem('nexus_github_pat');
        const savedUser = localStorage.getItem('nexus_github_user');
        if (savedPat && savedUser) {
            statusText.textContent = `Connected as @${savedUser}`;
            btnConnectGithub.textContent = 'Disconnect';
            btnConnectGithub.classList.add('btn-secondary'); 
            const badge = document.createElement('span');
            badge.className = 'integration-badge connected';
            badge.textContent = 'Connected';
            badgeContainer.appendChild(badge);
        }
        
        btnConnectGithub.addEventListener('click', () => {
            if (localStorage.getItem('nexus_github_pat')) {
                // Disconnect
                localStorage.removeItem('nexus_github_pat');
                localStorage.removeItem('nexus_github_user');
                statusText.textContent = 'Not connected';
                btnConnectGithub.textContent = 'Connect';
                btnConnectGithub.classList.remove('btn-secondary');
                const badge = badgeContainer.querySelector('.integration-badge');
                if (badge) badge.remove();
                showNotification('GitHub Disconnected', 'Your integration has been removed.', 'ri-github-line', '#000', '#fff');
                return;
            }
            overlayGithub.classList.remove('hidden');
        });
        
        btnCloseGithub.addEventListener('click', () => overlayGithub.classList.add('hidden'));
        
        btnSubmitGithub.addEventListener('click', async () => {
            const pat = inputPat.value.trim();
            if (!pat) return;
            
            btnSubmitGithub.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Connecting...';
            btnSubmitGithub.disabled = true;
            
            try {
                const res = await fetch('https://api.github.com/user', {
                    headers: {
                        'Authorization': `token ${pat}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                
                if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem('nexus_github_pat', pat);
                    localStorage.setItem('nexus_github_user', data.login);
                    
                    statusText.textContent = `Connected as @${data.login}`;
                    btnConnectGithub.textContent = 'Disconnect';
                    btnConnectGithub.classList.add('btn-secondary');
                    
                    const badge = document.createElement('span');
                    badge.className = 'integration-badge connected';
                    badge.textContent = 'Connected';
                    badgeContainer.appendChild(badge);
                    
                    overlayGithub.classList.add('hidden');
                    inputPat.value = '';
                    
                    showNotification('GitHub Connected', `Successfully authenticated as @${data.login}`, 'ri-github-fill', '#000', '#fff');
                } else {
                    alert('Invalid Personal Access Token. Please ensure it has the correct permissions and try again.');
                }
            } catch (e) {
                alert('Failed to connect to GitHub. Check your network connection.');
            }
            
            btnSubmitGithub.innerHTML = '<i class="ri-link"></i> Connect GitHub';
            btnSubmitGithub.disabled = false;
        });
    }

})();

