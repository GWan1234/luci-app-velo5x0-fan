include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-velo5x0-fan
PKG_VERSION:=1.0.0
PKG_RELEASE:=8

LUCI_TITLE:=Temperature control for VeloCloud 5x0
LUCI_URL:=https://github.com/dqsq2e2/luci-app-velo5x0-fan
LUCI_DEPENDS:=+luci-base +rpcd +rpcd-mod-ucode +i2c-tools
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
