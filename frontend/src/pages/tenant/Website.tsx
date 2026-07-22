import {
  listActiveModules,
  listWebsiteContentItems,
  createWebsiteContentItem,
  updateWebsiteContentItem,
  deleteWebsiteContentItem,
  importWebsiteContentItems,
  syncWebsiteContentItems,
  uploadContentImage,
} from "../../api/websiteContent";
import { WebsiteContentManager } from "../../components/WebsiteContentManager";

export default function Website() {
  return (
    <div className="px-8 py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Website Manager</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Manage the content for whatever website features your account has been set up with. Each tab below
        reflects the permission level Super Admin has granted for that feature — view-only until they've
        delegated edit access.
      </p>

      <WebsiteContentManager
        listModules={listActiveModules}
        emptyMessage="No website features are set up for your business yet. Contact support to have your website's content modules configured."
        buildApi={(featureKey) => ({
          list: (options) => listWebsiteContentItems(featureKey, options),
          create: (payload) => createWebsiteContentItem(featureKey, payload),
          update: (id, payload) => updateWebsiteContentItem(featureKey, id, payload),
          remove: (id) => deleteWebsiteContentItem(featureKey, id),
          importItems: (filters) => importWebsiteContentItems(featureKey, filters),
          syncItems: () => syncWebsiteContentItems(featureKey),
          uploadImage: (file) => uploadContentImage(featureKey, file),
        })}
      />
    </div>
  );
}
