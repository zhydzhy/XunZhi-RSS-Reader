// Progress/ProgressCode values from ArkData; runnable without a device.
export function syncStatus(schedule: number, code: number, incomplete: number = 0): string {
  if (code !== 0) {
    const reasons: string[] = ['成功', '未知错误', '网络错误', '云服务不可用／同步开关关闭',
      '云资源正被占用，稍后重试', '记录数量或大小超限', '云空间不足', '被网络策略阻止', '同步已停止'];
    const reason = code >= 0 && code < reasons.length ? reasons[code] : '未识别错误';
    return `同步未成功：${reason}（code=${code}, stage=${schedule}）`;
  }
  if (schedule === 2) {
    return incomplete > 0 ? `本轮结束，但有 ${incomplete} 条失败或未完成；请重试` : '本轮端云同步完成；仍需在另一台设备核对记录';
  }
  return schedule === 0 ? '同步已开始，尚未完成' : '同步进行中，尚未完成';
}
