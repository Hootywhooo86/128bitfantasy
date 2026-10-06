package expo.modules.espncookies

import android.webkit.CookieManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The WebView cookie store, which the in-app ESPN sign-in writes to.
 * Android's CookieManager includes HttpOnly cookies, which a page's own
 * JavaScript can't see.
 */
class EspnCookiesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EspnCookies")

    // "name=value; name2=value2" for the URL, or "" when there are none.
    AsyncFunction("get") { url: String ->
      CookieManager.getInstance().getCookie(url) ?: ""
    }.runOnQueue(Queues.MAIN)

    // Expires one cookie so an old session isn't mistaken for a new sign-in.
    AsyncFunction("expire") { url: String, name: String ->
      val cm = CookieManager.getInstance()
      cm.setCookie(url, "$name=; Max-Age=0; Path=/; Domain=.espn.com")
      cm.flush()
    }.runOnQueue(Queues.MAIN)
  }
}
