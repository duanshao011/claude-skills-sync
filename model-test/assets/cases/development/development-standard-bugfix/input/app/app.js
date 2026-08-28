const tasks = [
  { name: "通勤杯首发", status: "active", spend: "120.5" },
  { name: "轻量伞复投", status: "paused", spend: "87" },
  { name: "收纳包加热", status: "active", spend: "100" }
];

function filterTasks(items, status) {
  if (status === "all") return items;
  return items.filter(item => item.state === status);
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.spend, 0);
}

function render(status = "all") {
  const visible = filterTasks(tasks, status);
  document.querySelector("#task-list").innerHTML = visible.map(item => `<li><span>${item.name}</span><span>${item.status}</span></li>`).join("");
  document.querySelector("#total-spend").textContent = calculateTotal(visible);
}

if (typeof document !== "undefined") {
  document.querySelector("#status-filter").addEventListener("change", event => render(event.target.value));
  render();
}

if (typeof module !== "undefined") module.exports = { tasks, filterTasks, calculateTotal };
