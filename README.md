# 温度控制

面向已经完成 VeloCloud Edge 5x0 硬件适配的 ImmortalWrt / OpenWrt 固件。
软件包名称：`luci-app-velo5x0-fan`；菜单入口：**系统 → 温度控制**。

## 功能

- 手动模式：百分比风速滑块。
- 自动温控：CPU、WiFi、CPU/WiFi 最高温或平均温、EMC2104 主板温度。
- 普通设置：起转温度、停转温度、满速温度。
- 高级设置：低温风速、CPU 核心选择、自定义四点曲线。
- 原生 LuCI 配置表单及“保存并应用 / 保存 / 重置”按钮。
- 实时显示 CPU 核心标签、WiFi 温度、控制服务状态与已应用的 PWM 输出。

“低温风速”是自动线性曲线的低温端 PWM 输出，不是 RPM，也不影响手动模式。
它位于高级设置；自定义曲线使用各点自己的输出值。

## 硬件前提

- 需要固件已有 5x0 主板驱动和开机硬件初始化；此插件不安装内核适配补丁。
- 控制器：I2C bus 9 上的 EMC2104（0x2f），使用 FAN1。
- PCA9557（9-001c）的 pin6 高、pin7 低才是 PWM 直通；不可用反向绑带调速。
- 低温停转时才使用反向绑带配合零输出断电，恢复时回到 PWM 直通。
- 正常手动和自动模式固定开环，避免不稳定的低速 tach 读数干扰调速。
- PWM 0% 不保证风扇停转；当前测试风扇有内部最低转速。
- WiFi 温度依赖 `ath10k_hwmon`；CPU 温度依赖 `coretemp`。
- 需要提供 `form.RangeSliderValue` 的现代 LuCI 和 `rpcd-mod-ucode`。

## 编译

在已适配的固件源码目录中添加 feed：

```sh
echo 'src-git velo5x0fan https://github.com/dqsq2e2/luci-app-velo5x0-fan.git;main' >> feeds.conf.default
./scripts/feeds update velo5x0fan
./scripts/feeds install -p velo5x0fan luci-app-velo5x0-fan
```

设备配置启用：

```text
CONFIG_PACKAGE_luci-app-velo5x0-fan=y
```

也可将仓库克隆到 `package/luci-app-velo5x0-fan` 后选择该包编译。

## 配置与升级

本包包含 LuCI 页面、RPC 状态接口、`velo5x0-fand` 守护脚本和 procd 服务。
配置保存在 `/etc/config/velo5x0` 的 `fan` 节，不替换同文件中的网络、
交换机或其他板级设置。首次安装只在没有 `fan` 节时创建默认配置，
已有风扇配置原样保留，并通过 `keep.d` 保留到后续系统升级。

默认自动线性控制：42°C 停转、45°C 起转、60°C 满速，低温 PWM 为
40/255（约 16%）。保存仅暂存，应用后由 procd 配置触发器重新加载。

## 来源

风扇控制脚本沿用已有 5x0 固件适配代码，其早期实现来自
[gallops-gannets/velo540openwrt](https://github.com/gallops-gannets/velo540openwrt)，
在本项目中继续维护 PWM 直通、自动曲线与 LuCI 集成。
