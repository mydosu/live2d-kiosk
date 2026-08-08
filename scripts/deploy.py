#!/usr/bin/env python3
"""Live2D Kiosk 一键部署脚本（自动化配置）

用法（在 D:\\CODE\\Live2D 下运行）：
  python scripts\\deploy.py                # 构建前端 + 部署全部（前端/后台/服务重启）
  python scripts\\deploy.py --skip-build   # 跳过 npm build（只部署现有 dist）
  python scripts\\deploy.py --kiosk-only   # 只部署前端 + 重启 kiosk
  python scripts\\deploy.py --admin-only   # 只部署后台 + 重启 admin

安全：部署前自动备份板子上的 config.json（用户个性化配置），部署后恢复 —— 排版/设置不丢失。
"""
import argparse
import os
import stat
import subprocess
import sys

import paramiko

HOST = os.environ.get("RK_HOST", "192.168.5.32")
USER = os.environ.get("RK_USER", "myduso")
PASS = os.environ.get("RK_PASS", "")  # 从环境变量 RK_PASS 读取，勿硬编码密码
PORT = 22

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # D:\CODE\Live2D
DIST = os.path.join(BASE, "demo", "dist")
ADMIN = os.path.join(BASE, "admin")
PANEL_DIR = "/opt/dashboard/live2D panel"
ADMIN_DIR = "/opt/dashboard/admin"


def ssh_conn():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=15)
    return c


def run(c, cmd):
    _, out, err = c.exec_command(cmd, timeout=120)
    o = out.read().decode(errors="replace")
    e = err.read().decode(errors="replace")
    return o, e


def upload_dir(c, local, remote):
    """SFTP 递归上传目录"""
    sftp = c.open_sftp()
    try:
        for root, dirs, files in os.walk(local):
            rel = os.path.relpath(root, local)
            rdir = remote if rel == "." else f"{remote}/{rel.replace(os.sep, '/')}"
            try:
                sftp.stat(rdir)
            except FileNotFoundError:
                sftp.mkdir(rdir)
            for f in files:
                sftp.put(os.path.join(root, f), f"{rdir}/{f}")
    finally:
        sftp.close()


def build_frontend():
    print("[1/4] 构建前端（npm run build）…")
    r = subprocess.run("npm run build", shell=True, cwd=os.path.join(BASE, "demo"),
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("构建失败：", r.stderr[-500:])
        sys.exit(1)
    for line in r.stdout.strip().splitlines()[-3:]:
        print("  ", line.strip())


def deploy_kiosk(c):
    print("[2/4] 上传前端 dist → 板子…")
    upload_dir(c, DIST, "/home/myduso/dist")
    print("[3/4] 部署前端 + 备份/恢复 config.json…")
    o, e = run(c, (
        f"cp '{PANEL_DIR}/config.json' /tmp/cfg.bak 2>/dev/null; "
        f"cp -r /home/myduso/dist/. '{PANEL_DIR}/' && "
        f"cp /tmp/cfg.bak '{PANEL_DIR}/config.json' 2>/dev/null; "
        f"sudo systemctl restart live2d-kiosk && echo KIOSK_OK"
    ))
    print("  ", (o + e).strip()[-200:])


def deploy_admin(c):
    print("[2/4] 上传后台 admin → 板子…")
    upload_dir(c, ADMIN, "/home/myduso/admin")
    print("[3/4] 部署后台…")
    o, e = run(c, (
        f"sudo rm -rf {ADMIN_DIR} && sudo cp -r /home/myduso/admin {ADMIN_DIR} && "
        f"sudo chown -R {USER}:{USER} {ADMIN_DIR} && "
        f"sudo systemctl restart live2d-admin && echo ADMIN_OK"
    ))
    print("  ", (o + e).strip()[-200:])


def verify(c):
    print("[4/4] 验证服务状态…")
    o, e = run(c, "systemctl is-active live2d-web live2d-kiosk live2d-admin; ss -tlnp 2>/dev/null | grep -E ':(80|8080|9000)' | wc -l")
    print("  服务:", o.strip().replace("\n", " / "))
    print("  端口(80/8080/9000)监听数:", e.strip() or o.strip().splitlines()[-1] if o else "?")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-build", action="store_true")
    ap.add_argument("--kiosk-only", action="store_true")
    ap.add_argument("--admin-only", action="store_true")
    args = ap.parse_args()

    if not args.skip_build and not args.admin_only:
        build_frontend()

    c = ssh_conn()
    try:
        if not args.admin_only:
            deploy_kiosk(c)
        if not args.kiosk_only:
            deploy_admin(c)
        verify(c)
        print("\n✅ 部署完成。板子地址：RNDIS 192.168.30.1 / 局域网 192.168.5.32")
    finally:
        c.close()


if __name__ == "__main__":
    main()
